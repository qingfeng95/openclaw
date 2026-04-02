import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../../../src/infra/is-main.ts";
import {
  getSharedConsoleContainerBySelector,
  listSharedConsoleContainers,
  readSharedConsoleContainerLogs,
  runDockerCommandDefault,
  runSharedConsoleContainerAction,
  type DockerCommandInvocation,
  type DockerCommandResult,
  type DockerContainerRecord,
} from "./containers.ts";
import {
  getSharedInstanceById,
  listSharedInstances,
  resolveSharedConsoleApiBashPath,
  resolveSharedConsoleDedicatedInstancesRoot,
  resolveSharedConsoleInstancesRoot,
  resolveSharedConsoleRepoRoot,
  updateSharedInstanceName,
  validateSharedInstanceId,
  type BuildSharedInstanceRecordOptions,
  type SharedInstanceRecord,
} from "./instances.ts";

const DEFAULT_SHARED_CONSOLE_API_HOST = "127.0.0.1";
const DEFAULT_SHARED_CONSOLE_API_PORT = 43100;
const DEFAULT_SHARED_CONSOLE_API_PROBE_TIMEOUT_MS = 1_500;

type JsonValue = Record<string, unknown>;
type InstancePool = "shared" | "dedicated";

export type SharedConsoleApiConfig = {
  host: string;
  port: number;
  repoRoot: string;
  sharedInstancesRoot: string;
  dedicatedInstancesRoot: string;
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
  listDockerContainers?: () => Promise<DockerContainerRecord[]>;
  runDockerCommand?: (invocation: DockerCommandInvocation) => Promise<DockerCommandResult>;
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
    sharedInstancesRoot: resolveSharedConsoleInstancesRoot(env, repoRoot),
    dedicatedInstancesRoot: resolveSharedConsoleDedicatedInstancesRoot(env, repoRoot),
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

function readInstancePool(body: Record<string, unknown>, fallback: InstancePool): InstancePool {
  const value = readOptionalString(body, "pool");
  if (!value) {
    return fallback;
  }
  if (value === "shared" || value === "dedicated") {
    return value;
  }
  throw new HttpError(400, '"pool" must be "shared" or "dedicated".');
}

function readRuntimeKind(body: Record<string, unknown>): "host" | "container" {
  const value = readOptionalString(body, "runtimeKind");
  if (!value || value === "host") {
    return "host";
  }
  if (value === "container") {
    return "container";
  }
  throw new HttpError(400, '"runtimeKind" must be "host" or "container".');
}

function resolveInstancesRoot(config: SharedConsoleApiConfig, pool: InstancePool): string {
  return pool === "dedicated" ? config.dedicatedInstancesRoot : config.sharedInstancesRoot;
}

function parseNamedInstanceRoute(
  url: URL,
  basePath: string,
  pool: InstancePool,
):
  | { kind: "collection"; pool: InstancePool }
  | { kind: "item"; pool: InstancePool; id: string }
  | { kind: "action"; pool: InstancePool; id: string; action: "start" | "stop" | "restart" }
  | null {
  if (url.pathname === basePath) {
    return { kind: "collection", pool };
  }
  const itemMatch = url.pathname.match(new RegExp(`^${basePath}/([^/]+)$`));
  if (itemMatch) {
    return { kind: "item", pool, id: decodeURIComponent(itemMatch[1] ?? "") };
  }
  const actionMatch = url.pathname.match(new RegExp(`^${basePath}/([^/]+)/(start|stop|restart)$`));
  if (actionMatch) {
    return {
      kind: "action",
      pool,
      id: decodeURIComponent(actionMatch[1] ?? ""),
      action: actionMatch[2] as "start" | "stop" | "restart",
    };
  }
  return null;
}

function parseInstanceRoute(url: URL) {
  return (
    parseNamedInstanceRoute(url, "/api/instances", "shared") ??
    parseNamedInstanceRoute(url, "/api/shared-instances", "shared") ??
    parseNamedInstanceRoute(url, "/api/dedicated-instances", "dedicated")
  );
}

function parseContainerRoute(url: URL):
  | { kind: "collection" }
  | { kind: "logs"; id: string }
  | { kind: "action"; id: string; action: "start" | "stop" | "restart" }
  | null {
  if (url.pathname === "/api/containers") {
    return { kind: "collection" };
  }
  const logsMatch = url.pathname.match(/^\/api\/containers\/([^/]+)\/logs$/);
  if (logsMatch) {
    return { kind: "logs", id: decodeURIComponent(logsMatch[1] ?? "") };
  }
  const actionMatch = url.pathname.match(/^\/api\/containers\/([^/]+)\/(start|stop|restart)$/);
  if (actionMatch) {
    return {
      kind: "action",
      id: decodeURIComponent(actionMatch[1] ?? ""),
      action: actionMatch[2] as "start" | "stop" | "restart",
    };
  }
  return null;
}

function readTailQuery(url: URL, defaultValue = 160): number {
  const value = url.searchParams.get("tail")?.trim();
  if (!value) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, '"tail" must be a positive integer.');
  }
  return parsed;
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
    runContainerProbe:
      includeProbe
        ? async (instance, request) => {
            const selector = instance.runtime.containerName?.trim() || instance.runtime.containerId?.trim();
            if (!selector) {
              throw new Error(`Instance ${instance.id} is container-managed but has no container selector.`);
            }
            if (!instance.port) {
              throw new Error(`Instance ${instance.id} is missing port for container probe.`);
            }
            const runDockerCommand = deps.runDockerCommand ?? runDockerCommandDefault;
            const result = await runDockerCommand({
              args: [
                "exec",
                selector,
                "node",
                "-e",
                "const http=require('node:http');const url=process.argv[1];const timeoutMs=Number(process.argv[2]);let body='';let done=false;const finish=(code,output='')=>{if(done)return;done=true;clearTimeout(timer);if(output)process.stdout.write(output);process.exit(code);};const req=http.get(url,(res)=>{res.setEncoding('utf8');res.on('data',(chunk)=>{body+=chunk;});res.on('end',()=>finish(res.statusCode===200?0:1,body));});req.on('error',(error)=>finish(1,String(error?.message??error??'')));const timer=setTimeout(()=>{req.destroy();finish(1,'timeout');},timeoutMs);timer.unref?.();",
                `http://127.0.0.1:${instance.port}${request.path}`,
                String(request.timeoutMs),
              ],
            });
            if (result.exitCode !== 0) {
              throw new Error(result.stderr.trim() || result.stdout.trim() || "container probe failed");
            }
            return JSON.parse(result.stdout);
          }
        : undefined,
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
  pool: InstancePool,
  id: string,
  includeProbe: boolean,
): Promise<SharedInstanceRecord> {
  const instance = await getSharedInstanceById(
    resolveInstancesRoot(config, pool),
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
      OPENCLAW_SHARED_INSTANCES_ROOT: config.sharedInstancesRoot,
      OPENCLAW_DEDICATED_INSTANCES_ROOT: config.dedicatedInstancesRoot,
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
  fallbackPool: InstancePool,
): Promise<void> {
  const body = await readJsonBody(req);
  const pool = readInstancePool(body, fallbackPool);
  const id = ensureInstanceId(readOptionalString(body, "id") ?? "");
  const name = readOptionalString(body, "name");
  const port = readOptionalPort(body);
  const runtimeKind = readRuntimeKind(body);
  const containerName = readOptionalString(body, "containerName");
  const containerId = readOptionalString(body, "containerId");
  if (runtimeKind === "container" && !containerName && !containerId) {
    throw new HttpError(400, 'Container-managed instances require "containerName" or "containerId".');
  }
  const profile =
    readOptionalString(body, "profile") ?? `${pool === "dedicated" ? "dedicated" : "shared"}-${id}`;
  const template = readOptionalString(body, "template");
  const bind = readOptionalString(body, "bind");

  const args = [id, "--root", resolveInstancesRoot(config, pool)];
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
  args.push("--runtime-kind", runtimeKind);
  if (containerName) {
    args.push("--container-name", containerName);
  }
  if (containerId) {
    args.push("--container-id", containerId);
  }

  const result = await runOpsCommand(config, deps, {
    scriptName: "create-instance.sh",
    args,
  });
  const instance = await ensureInstance(config, deps, pool, id, false);
  sendJson(res, 201, {
    ok: true,
    pool,
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
  pool: InstancePool,
  id: string,
): Promise<void> {
  await ensureInstance(config, deps, pool, id, false);
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
  await updateSharedInstanceName(resolveInstancesRoot(config, pool), id, name);
  const instance = await ensureInstance(config, deps, pool, id, false);
  sendJson(res, 200, {
    ok: true,
    item: instance,
  });
}

async function handleAction(
  res: ServerResponse,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  pool: InstancePool,
  id: string,
  action: "start" | "stop" | "restart",
): Promise<void> {
  await ensureInstance(config, deps, pool, id, false);
  const result = await runOpsCommand(config, deps, {
    scriptName: `${action}-instance.sh`,
    args: [id, "--root", resolveInstancesRoot(config, pool)],
  });
  const instance = await ensureInstance(config, deps, pool, id, action !== "stop");
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

async function listCurrentInstances(
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  pool: InstancePool = "shared",
): Promise<SharedInstanceRecord[]> {
  return await listSharedInstances(resolveInstancesRoot(config, pool), resolveRecordOptions(config, deps, false));
}

async function listAllCurrentInstances(
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
): Promise<SharedInstanceRecord[]> {
  const [sharedItems, dedicatedItems] = await Promise.all([
    listCurrentInstances(config, deps, "shared"),
    listCurrentInstances(config, deps, "dedicated"),
  ]);
  return [...sharedItems, ...dedicatedItems];
}

async function handleContainerAction(
  res: ServerResponse,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  id: string,
  action: "start" | "stop" | "restart",
): Promise<void> {
  const instances = await listAllCurrentInstances(config, deps);
  const container = await getSharedConsoleContainerBySelector(id, instances, {
    listDockerContainers: deps.listDockerContainers,
  });
  if (!container) {
    throw new HttpError(404, `Container not found: ${id}`, "not_found");
  }
  if (container.source !== "docker") {
    throw new HttpError(409, `Container ${container.name} is not currently manageable through Docker.`, "conflict");
  }
  const result = await runSharedConsoleContainerAction(id, action, instances, {
    listDockerContainers: deps.listDockerContainers,
    runDockerCommand: deps.runDockerCommand,
  });
  sendJson(res, 200, {
    ok: true,
    action,
    item: result.container,
    command: {
      engine: "docker",
      stdout: result.command.stdout.trim(),
      stderr: result.command.stderr.trim(),
      exitCode: result.command.exitCode,
    },
  });
}

async function handleContainerLogs(
  res: ServerResponse,
  url: URL,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  id: string,
): Promise<void> {
  const instances = await listAllCurrentInstances(config, deps);
  const container = await getSharedConsoleContainerBySelector(id, instances, {
    listDockerContainers: deps.listDockerContainers,
  });
  if (!container) {
    throw new HttpError(404, `Container not found: ${id}`, "not_found");
  }
  if (container.source !== "docker") {
    throw new HttpError(409, `Container ${container.name} does not have Docker logs available yet.`, "conflict");
  }
  const result = await readSharedConsoleContainerLogs(id, instances, {
    listDockerContainers: deps.listDockerContainers,
    runDockerCommand: deps.runDockerCommand,
    tail: readTailQuery(url),
  });
  sendJson(res, 200, {
    ok: true,
    item: result.container,
    logs: {
      tail: result.tail,
      text: result.text,
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

        const containerRoute = parseContainerRoute(url);
        if (containerRoute) {
          if (containerRoute.kind === "collection") {
            if (req.method !== "GET") {
              sendError(res, 405, "Method Not Allowed", "method_not_allowed");
              return;
            }
            const instances = await listAllCurrentInstances(config, deps);
            const snapshot = await listSharedConsoleContainers(instances, {
              listDockerContainers: deps.listDockerContainers,
              includeAllDockerContainers: readBooleanQuery(url, "all", false),
            });
            sendJson(res, 200, {
              ok: true,
              items: snapshot.items,
              meta: snapshot.meta,
            });
            return;
          }

          if (containerRoute.kind === "logs") {
            if (req.method !== "GET") {
              sendError(res, 405, "Method Not Allowed", "method_not_allowed");
              return;
            }
            await handleContainerLogs(res, url, config, deps, containerRoute.id);
            return;
          }

          if (req.method !== "POST") {
            sendError(res, 405, "Method Not Allowed", "method_not_allowed");
            return;
          }
          await handleContainerAction(res, config, deps, containerRoute.id, containerRoute.action);
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
              resolveInstancesRoot(config, route.pool),
              resolveRecordOptions(config, deps, includeProbe),
            );
            sendJson(res, 200, {
              ok: true,
              items,
              meta: {
                pool: route.pool,
                instancesRoot: resolveInstancesRoot(config, route.pool),
                includeProbe,
              },
            });
            return;
          }
          if (req.method === "POST") {
            await handleCreateInstance(req, res, config, deps, route.pool);
            return;
          }
          sendError(res, 405, "Method Not Allowed", "method_not_allowed");
          return;
        }

        if (route.kind === "item") {
          if (req.method === "GET") {
            const includeProbe = readBooleanQuery(url, "includeProbe", true);
            const item = await ensureInstance(config, deps, route.pool, route.id, includeProbe);
            sendJson(res, 200, {
              ok: true,
              item,
            });
            return;
          }
          if (req.method === "PATCH") {
            await handlePatchInstance(req, res, config, deps, route.pool, route.id);
            return;
          }
          sendError(res, 405, "Method Not Allowed", "method_not_allowed");
          return;
        }

        if (req.method !== "POST") {
          sendError(res, 405, "Method Not Allowed", "method_not_allowed");
          return;
        }
        await handleAction(res, config, deps, route.pool, route.id, route.action);
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
    `[shared-console-api] listening on http://${config.host}:${config.port} (sharedRoot=${config.sharedInstancesRoot}, dedicatedRoot=${config.dedicatedInstancesRoot})\n`,
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
