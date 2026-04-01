import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../../../src/infra/is-main.js";
import {
  getSharedInstanceById,
  listSharedInstances,
  resolveSharedConsoleApiBashPath,
  resolveSharedConsoleInstancesRoot,
  resolveSharedConsoleRepoRoot,
  updateSharedInstanceName,
  validateSharedInstanceId,
  type BuildSharedInstanceRecordOptions,
  type SharedInstanceRecord,
} from "./instances.js";

const DEFAULT_SHARED_CONSOLE_API_HOST = "127.0.0.1";
const DEFAULT_SHARED_CONSOLE_API_PORT = 43100;
const DEFAULT_SHARED_CONSOLE_API_PROBE_TIMEOUT_MS = 1_500;

type JsonValue = Record<string, unknown>;

export type SharedConsoleApiConfig = {
  host: string;
  port: number;
  repoRoot: string;
  instancesRoot: string;
  bashPath: string;
  probeTimeoutMs: number;
};

export type OpsCommandInvocation = {
  scriptName: string;
  args: string[];
};

export type OpsCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type SharedConsoleApiDeps = {
  env?: NodeJS.ProcessEnv;
  config?: Partial<SharedConsoleApiConfig>;
  fetchImpl?: typeof fetch;
  runOpsCommand?: (invocation: OpsCommandInvocation) => Promise<OpsCommandResult>;
};

class HttpError extends Error {
  statusCode: number;
  errorType: string;

  constructor(statusCode: number, message: string, errorType = "invalid_request") {
    super(message);
    this.statusCode = statusCode;
    this.errorType = errorType;
  }
}

class OpsCommandError extends Error {
  result: OpsCommandResult;
  invocation: OpsCommandInvocation;

  constructor(invocation: OpsCommandInvocation, result: OpsCommandResult) {
    super(
      [
        `${invocation.scriptName} exited with code ${result.exitCode}.`,
        result.stderr.trim(),
        result.stdout.trim(),
      ]
        .filter(Boolean)
        .join(" "),
    );
    this.invocation = invocation;
    this.result = result;
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveSharedConsoleApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): SharedConsoleApiConfig {
  const repoRoot = resolveSharedConsoleRepoRoot(import.meta.url);
  return {
    host: env.SHARED_CONSOLE_API_HOST?.trim() || DEFAULT_SHARED_CONSOLE_API_HOST,
    port: parsePositiveInteger(env.SHARED_CONSOLE_API_PORT, DEFAULT_SHARED_CONSOLE_API_PORT),
    repoRoot,
    instancesRoot: resolveSharedConsoleInstancesRoot(env, repoRoot),
    bashPath: resolveSharedConsoleApiBashPath(env),
    probeTimeoutMs: parsePositiveInteger(
      env.SHARED_CONSOLE_API_PROBE_TIMEOUT_MS,
      DEFAULT_SHARED_CONSOLE_API_PROBE_TIMEOUT_MS,
    ),
  };
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
}

function sendJson(res: ServerResponse, statusCode: number, body: JsonValue): void {
  setCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendError(
  res: ServerResponse,
  statusCode: number,
  message: string,
  errorType = "invalid_request",
): void {
  sendJson(res, statusCode, {
    ok: false,
    error: {
      type: errorType,
      message,
    },
  });
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function readBooleanQuery(url: URL, key: string, defaultValue: boolean): boolean {
  const value = url.searchParams.get(key)?.trim().toLowerCase();
  if (!value) {
    return defaultValue;
  }
  return value === "1" || value === "true" || value === "yes";
}

function readOptionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `"${key}" must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readOptionalPort(body: Record<string, unknown>): number | undefined {
  const value = body.port;
  if (value == null) {
    return undefined;
  }
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    throw new HttpError(400, '"port" must be an integer between 1 and 65535.');
  }
  return Math.trunc(parsed);
}

function parseInstanceRoute(url: URL):
  | { kind: "collection" }
  | { kind: "item"; id: string }
  | { kind: "action"; id: string; action: "start" | "stop" | "restart" }
  | null {
  if (url.pathname === "/api/instances") {
    return { kind: "collection" };
  }
  const itemMatch = url.pathname.match(/^\/api\/instances\/([^/]+)$/);
  if (itemMatch) {
    return { kind: "item", id: decodeURIComponent(itemMatch[1] ?? "") };
  }
  const actionMatch = url.pathname.match(/^\/api\/instances\/([^/]+)\/(start|stop|restart)$/);
  if (actionMatch) {
    return {
      kind: "action",
      id: decodeURIComponent(actionMatch[1] ?? ""),
      action: actionMatch[2] as "start" | "stop" | "restart",
    };
  }
  return null;
}

function resolveRecordOptions(
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  includeProbe: boolean,
): BuildSharedInstanceRecordOptions {
  return {
    includeProbe,
    fetchImpl: deps.fetchImpl,
    probeTimeoutMs: config.probeTimeoutMs,
  };
}

function ensureInstanceId(id: string): string {
  if (!validateSharedInstanceId(id)) {
    throw new HttpError(400, `Invalid instance id: ${id}`);
  }
  return id;
}

async function ensureInstance(
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  id: string,
  includeProbe: boolean,
): Promise<SharedInstanceRecord> {
  const instance = await getSharedInstanceById(
    config.instancesRoot,
    ensureInstanceId(id),
    resolveRecordOptions(config, deps, includeProbe),
  );
  if (!instance) {
    throw new HttpError(404, `Instance not found: ${id}`, "not_found");
  }
  return instance;
}

async function runOpsCommandDefault(
  config: SharedConsoleApiConfig,
  invocation: OpsCommandInvocation,
): Promise<OpsCommandResult> {
  const scriptPath = path.join(config.repoRoot, "ops", invocation.scriptName);
  const child = spawn(config.bashPath, [scriptPath, ...invocation.args], {
    cwd: config.repoRoot,
    env: {
      ...process.env,
      OPENCLAW_SHARED_INSTANCES_ROOT: config.instancesRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const result = await new Promise<OpsCommandResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });

  if (result.exitCode !== 0) {
    throw new OpsCommandError(invocation, result);
  }
  return result;
}

async function runOpsCommand(
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  invocation: OpsCommandInvocation,
): Promise<OpsCommandResult> {
  const runner =
    deps.runOpsCommand ?? ((value: OpsCommandInvocation) => runOpsCommandDefault(config, value));
  return await runner(invocation);
}

async function handleCreateInstance(
  req: IncomingMessage,
  res: ServerResponse,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
): Promise<void> {
  const body = await readJsonBody(req);
  const id = ensureInstanceId(readOptionalString(body, "id") ?? "");
  const name = readOptionalString(body, "name");
  const port = readOptionalPort(body);
  const profile = readOptionalString(body, "profile");
  const template = readOptionalString(body, "template");
  const bind = readOptionalString(body, "bind");

  const args = [id, "--root", config.instancesRoot];
  if (typeof port === "number") {
    args.push("--port", String(port));
  }
  if (profile) {
    args.push("--profile", profile);
  }
  if (template) {
    args.push("--template", template);
  }
  if (bind) {
    args.push("--bind", bind);
  }
  if (name) {
    args.push("--name", name);
  }

  const result = await runOpsCommand(config, deps, {
    scriptName: "create-instance.sh",
    args,
  });
  const instance = await ensureInstance(config, deps, id, false);
  sendJson(res, 201, {
    ok: true,
    item: instance,
    command: {
      scriptName: "create-instance.sh",
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    },
  });
}

async function handlePatchInstance(
  req: IncomingMessage,
  res: ServerResponse,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  id: string,
): Promise<void> {
  await ensureInstance(config, deps, id, false);
  const body = await readJsonBody(req);
  const allowedKeys = new Set(["name"]);
  const unsupportedKeys = Object.keys(body).filter((key) => !allowedKeys.has(key));
  if (unsupportedKeys.length > 0) {
    throw new HttpError(
      400,
      `PATCH currently supports only: name. Unsupported keys: ${unsupportedKeys.join(", ")}`,
    );
  }
  const name = readOptionalString(body, "name");
  if (!name) {
    throw new HttpError(400, 'PATCH requires a non-empty "name".');
  }
  await updateSharedInstanceName(config.instancesRoot, id, name);
  const instance = await ensureInstance(config, deps, id, false);
  sendJson(res, 200, {
    ok: true,
    item: instance,
  });
}

async function handleAction(
  res: ServerResponse,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  id: string,
  action: "start" | "stop" | "restart",
): Promise<void> {
  await ensureInstance(config, deps, id, false);
  const result = await runOpsCommand(config, deps, {
    scriptName: `${action}-instance.sh`,
    args: [id, "--root", config.instancesRoot],
  });
  const instance = await ensureInstance(config, deps, id, action !== "stop");
  sendJson(res, 200, {
    ok: true,
    action,
    item: instance,
    command: {
      scriptName: `${action}-instance.sh`,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    },
  });
}

export function createSharedConsoleApiServer(deps: SharedConsoleApiDeps = {}): Server {
  const config = {
    ...resolveSharedConsoleApiConfig(deps.env),
    ...deps.config,
  };

  return createServer((req, res) => {
    void (async () => {
      try {
        setCorsHeaders(res);
        if ((req.method ?? "GET").toUpperCase() === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }

        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        if (url.pathname === "/healthz") {
          sendJson(res, 200, { ok: true, status: "live" });
          return;
        }

        const route = parseInstanceRoute(url);
        if (!route) {
          sendError(res, 404, "Not Found", "not_found");
          return;
        }

        if (route.kind === "collection") {
          if (req.method === "GET") {
            const includeProbe = readBooleanQuery(url, "includeProbe", false);
            const items = await listSharedInstances(
              config.instancesRoot,
              resolveRecordOptions(config, deps, includeProbe),
            );
            sendJson(res, 200, {
              ok: true,
              items,
              meta: {
                instancesRoot: config.instancesRoot,
                includeProbe,
              },
            });
            return;
          }
          if (req.method === "POST") {
            await handleCreateInstance(req, res, config, deps);
            return;
          }
          sendError(res, 405, "Method Not Allowed", "method_not_allowed");
          return;
        }

        if (route.kind === "item") {
          if (req.method === "GET") {
            const includeProbe = readBooleanQuery(url, "includeProbe", true);
            const item = await ensureInstance(config, deps, route.id, includeProbe);
            sendJson(res, 200, {
              ok: true,
              item,
            });
            return;
          }
          if (req.method === "PATCH") {
            await handlePatchInstance(req, res, config, deps, route.id);
            return;
          }
          sendError(res, 405, "Method Not Allowed", "method_not_allowed");
          return;
        }

        if (req.method !== "POST") {
          sendError(res, 405, "Method Not Allowed", "method_not_allowed");
          return;
        }
        await handleAction(res, config, deps, route.id, route.action);
      } catch (error) {
        if (error instanceof HttpError) {
          sendError(res, error.statusCode, error.message, error.errorType);
          return;
        }
        if (error instanceof OpsCommandError) {
          sendJson(res, 502, {
            ok: false,
            error: {
              type: "ops_command_failed",
              message: error.message,
              scriptName: error.invocation.scriptName,
              stdout: error.result.stdout.trim(),
              stderr: error.result.stderr.trim(),
              exitCode: error.result.exitCode,
            },
          });
          return;
        }
        sendError(
          res,
          500,
          error instanceof Error ? error.message : "Internal Server Error",
          "internal_error",
        );
      }
    })();
  });
}

export async function startSharedConsoleApiServer(deps: SharedConsoleApiDeps = {}): Promise<{
  server: Server;
  config: SharedConsoleApiConfig;
}> {
  const config = {
    ...resolveSharedConsoleApiConfig(deps.env),
    ...deps.config,
  };
  const server = createSharedConsoleApiServer({ ...deps, config });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => resolve());
  });
  return { server, config };
}

async function main(): Promise<void> {
  const { config } = await startSharedConsoleApiServer();
  process.stdout.write(
    `[shared-console-api] listening on http://${config.host}:${config.port} (instancesRoot=${config.instancesRoot})\n`,
  );
}

if (isMainModule({ currentFile: fileURLToPath(import.meta.url) })) {
  void main().catch((error) => {
    process.stderr.write(
      `[shared-console-api] failed to start: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
