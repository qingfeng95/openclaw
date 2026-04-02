import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
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
  updateSharedInstanceEnvValues,
  resolveSharedConsoleInstancesRoot,
  resolveSharedConsoleRepoRoot,
  updateSharedInstanceName,
  validateSharedInstanceId,
  type BuildSharedInstanceRecordOptions,
  type SharedInstanceRecord,
} from "./instances.ts";
import {
  buildSharedConsoleModelChannelCatalog,
  normalizeSharedConsoleModelChannelSettings,
  readSharedConsoleModelChannelSettings,
  resolveSharedConsoleModelChannelTarget,
  resolveSharedConsoleModelChannelsPath,
  writeSharedConsoleInstanceModelConfig,
  writeSharedConsoleModelChannelSettings,
} from "./model-channels.ts";

const DEFAULT_SHARED_CONSOLE_API_HOST = "127.0.0.1";
const DEFAULT_SHARED_CONSOLE_API_PORT = 43100;
const DEFAULT_SHARED_CONSOLE_API_PROBE_TIMEOUT_MS = 1_500;
const SAFE_CONTAINER_SELECTOR = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

type JsonValue = Record<string, unknown>;
type InstancePool = "shared" | "dedicated";

export type SharedConsoleApiConfig = {
  host: string;
  port: number;
  repoRoot: string;
  sharedInstancesRoot: string;
  dedicatedInstancesRoot: string;
  modelChannelsPath: string;
  bashPath: string;
  probeTimeoutMs: number;
  adminToken: string | null;
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
  const sharedInstancesRoot = resolveSharedConsoleInstancesRoot(env, repoRoot);
  const dedicatedInstancesRoot = resolveSharedConsoleDedicatedInstancesRoot(env, repoRoot);
  return {
    host: env.SHARED_CONSOLE_API_HOST?.trim() || DEFAULT_SHARED_CONSOLE_API_HOST,
    port: parsePositiveInteger(env.SHARED_CONSOLE_API_PORT, DEFAULT_SHARED_CONSOLE_API_PORT),
    repoRoot,
    sharedInstancesRoot,
    dedicatedInstancesRoot,
    modelChannelsPath: resolveSharedConsoleModelChannelsPath(env, sharedInstancesRoot),
    bashPath: resolveSharedConsoleApiBashPath(env),
    probeTimeoutMs: parsePositiveInteger(
      env.SHARED_CONSOLE_API_PROBE_TIMEOUT_MS,
      DEFAULT_SHARED_CONSOLE_API_PROBE_TIMEOUT_MS,
    ),
    adminToken: env.SHARED_CONSOLE_ADMIN_TOKEN?.trim() || null,
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

function readOptionalBooleanBody(
  body: Record<string, unknown>,
  key: string,
  defaultValue: boolean,
): boolean {
  const value = body[key];
  if (value == null) {
    return defaultValue;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes") {
      return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no") {
      return false;
    }
  }
  throw new HttpError(400, `"${key}" must be a boolean.`);
}

function readOptionalPositiveIntegerBody(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = body[key];
  if (value == null) {
    return undefined;
  }
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new HttpError(400, `"${key}" must be a positive integer.`);
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

function validateContainerName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

function resolveRequestedContainerNames(body: Record<string, unknown>): string[] {
  const exactName = readOptionalString(body, "name");
  const namePrefix = readOptionalString(body, "namePrefix");
  const count = readOptionalPositiveIntegerBody(body, "count") ?? 1;

  if (exactName && namePrefix) {
    throw new HttpError(400, 'Provide either "name" or "namePrefix", not both.');
  }
  if (!exactName && !namePrefix) {
    throw new HttpError(400, 'Container creation requires "name" or "namePrefix".');
  }
  if (exactName && count !== 1) {
    throw new HttpError(400, '"count" greater than 1 requires "namePrefix".');
  }

  const names = exactName
    ? [exactName]
    : count === 1
      ? [namePrefix ?? ""]
      : Array.from({ length: count }, (_, index) => `${namePrefix}-${index + 1}`);

  if (names.some((value) => !validateContainerName(value))) {
    throw new HttpError(
      400,
      'Container names must start with a letter or digit and contain only letters, digits, ".", "_" or "-".',
    );
  }
  return names;
}

function normalizeUiProxyPath(rawPath: string | undefined): string {
  const trimmed = rawPath?.trim() ?? "";
  if (!trimmed || trimmed === "/") {
    return "/";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
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

function parseNamedInstanceUiRoute(
  url: URL,
  basePath: string,
  pool: InstancePool,
):
  | { pool: InstancePool; id: string; proxiedPath: string }
  | null {
  const match = url.pathname.match(new RegExp(`^${basePath}/([^/]+)/ui(?:/(.*))?$`));
  if (!match) {
    return null;
  }
  return {
    pool,
    id: decodeURIComponent(match[1] ?? ""),
    proxiedPath: normalizeUiProxyPath(match[2]),
  };
}

function parseInstanceRoute(url: URL) {
  return (
    parseNamedInstanceRoute(url, "/api/instances", "shared") ??
    parseNamedInstanceRoute(url, "/api/shared-instances", "shared") ??
    parseNamedInstanceRoute(url, "/api/dedicated-instances", "dedicated")
  );
}

function parseInstanceUiRoute(url: URL) {
  return (
    parseNamedInstanceUiRoute(url, "/api/instances", "shared") ??
    parseNamedInstanceUiRoute(url, "/api/shared-instances", "shared") ??
    parseNamedInstanceUiRoute(url, "/api/dedicated-instances", "dedicated")
  );
}

function parseNamedInstanceTokenRoute(
  url: URL,
  basePath: string,
  pool: InstancePool,
): { pool: InstancePool; id: string } | null {
  const match = url.pathname.match(new RegExp(`^${basePath}/([^/]+)/token$`));
  if (!match) {
    return null;
  }
  return {
    pool,
    id: decodeURIComponent(match[1] ?? ""),
  };
}

function parseInstanceTokenRoute(url: URL) {
  return (
    parseNamedInstanceTokenRoute(url, "/api/instances", "shared") ??
    parseNamedInstanceTokenRoute(url, "/api/shared-instances", "shared") ??
    parseNamedInstanceTokenRoute(url, "/api/dedicated-instances", "dedicated")
  );
}

function parseNamedInstancePairingRoute(
  url: URL,
  basePath: string,
  pool: InstancePool,
):
  | { pool: InstancePool; id: string; action: "list" | "approve-latest" }
  | null {
  const listMatch = url.pathname.match(new RegExp(`^${basePath}/([^/]+)/pairing$`));
  if (listMatch) {
    return {
      pool,
      id: decodeURIComponent(listMatch[1] ?? ""),
      action: "list",
    };
  }
  const approveLatestMatch = url.pathname.match(
    new RegExp(`^${basePath}/([^/]+)/pairing/approve-latest$`),
  );
  if (approveLatestMatch) {
    return {
      pool,
      id: decodeURIComponent(approveLatestMatch[1] ?? ""),
      action: "approve-latest",
    };
  }
  return null;
}

function parseInstancePairingRoute(url: URL) {
  return (
    parseNamedInstancePairingRoute(url, "/api/instances", "shared") ??
    parseNamedInstancePairingRoute(url, "/api/shared-instances", "shared") ??
    parseNamedInstancePairingRoute(url, "/api/dedicated-instances", "dedicated")
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

async function resolveContainerBridgeIp(
  deps: SharedConsoleApiDeps,
  selector: string,
): Promise<string> {
  if (!SAFE_CONTAINER_SELECTOR.test(selector)) {
    throw new HttpError(400, `Invalid container selector: ${selector}`);
  }
  const runDockerCommand = deps.runDockerCommand ?? runDockerCommandDefault;
  const result = await runDockerCommand({
    args: [
      "inspect",
      "-f",
      "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
      selector,
    ],
  });
  if (result.exitCode !== 0) {
    throw new HttpError(
      502,
      result.stderr.trim() || result.stdout.trim() || `Failed to inspect container ${selector}.`,
      "docker_inspect_failed",
    );
  }
  const ipAddress = result.stdout.trim();
  if (!ipAddress) {
    throw new HttpError(409, `Container ${selector} does not have a bridge IP address yet.`, "conflict");
  }
  return ipAddress;
}

async function resolveInstanceProxyTarget(
  deps: SharedConsoleApiDeps,
  instance: SharedInstanceRecord,
): Promise<{ host: string; port: number }> {
  if (!instance.port) {
    throw new HttpError(409, `Instance ${instance.id} does not have a configured port.`, "conflict");
  }
  if (instance.process.state !== "running") {
    throw new HttpError(409, `Instance ${instance.id} is not running.`, "conflict");
  }
  if (instance.runtime.location === "container") {
    const selector = instance.runtime.containerName?.trim() || instance.runtime.containerId?.trim();
    if (!selector) {
      throw new HttpError(
        409,
        `Instance ${instance.id} is container-managed but has no container selector.`,
        "conflict",
      );
    }
    return {
      host: await resolveContainerBridgeIp(deps, selector),
      port: instance.port,
    };
  }
  return {
    host: "127.0.0.1",
    port: instance.port,
  };
}

async function readInstanceProxyToken(instance: SharedInstanceRecord): Promise<string | null> {
  try {
    const content = await fs.readFile(path.join(instance.paths.dir, "instance.env"), "utf8");
    const match = content.match(
      /^(?:INSTANCE_PROXY_TOKEN|OPENCLAW_GATEWAY_TOKEN)=(?:"([^"]*)"|([^\r\n#]+))/m,
    );
    const value = (match?.[1] ?? match?.[2] ?? "").trim();
    return value || null;
  } catch {
    return null;
  }
}

function readAdminTokenFromRequest(req: IncomingMessage): string | null {
  const raw = req.headers["x-shared-console-admin-token"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}

function isSecretEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireAdminRequest(config: SharedConsoleApiConfig, req: IncomingMessage): void {
  const configuredToken = config.adminToken?.trim() || "";
  if (!configuredToken) {
    throw new HttpError(404, "Admin mode is not enabled.", "not_found");
  }
  const requestToken = readAdminTokenFromRequest(req);
  if (!requestToken || !isSecretEqual(configuredToken, requestToken)) {
    throw new HttpError(403, "Admin token is invalid.", "forbidden");
  }
}

function isAdminRequest(config: SharedConsoleApiConfig, req: IncomingMessage): boolean {
  const configuredToken = config.adminToken?.trim() || "";
  const requestToken = readAdminTokenFromRequest(req);
  return Boolean(
    configuredToken &&
      requestToken &&
      isSecretEqual(configuredToken, requestToken),
  );
}

function copyProxyRequestHeaders(
  headers: IncomingMessage["headers"],
  targetHost: string,
  targetPort: number,
  extraHeaders: Record<string, string> = {},
): Headers {
  const forwarded = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (!key || HOP_BY_HOP_HEADERS.has(key.toLowerCase()) || key.toLowerCase() === "host") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        forwarded.append(key, entry);
      }
      continue;
    }
    if (typeof value === "string") {
      forwarded.set(key, value);
    }
  }
  forwarded.set("host", `${targetHost}:${targetPort}`);
  for (const [key, value] of Object.entries(extraHeaders)) {
    forwarded.set(key, value);
  }
  return forwarded;
}

function buildInstanceProxyOrigin(targetHost: string, targetPort: number): string {
  return `http://${targetHost}:${targetPort}`;
}

function copyProxyResponseHeaders(source: Headers, res: ServerResponse): void {
  for (const [key, value] of source.entries()) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase()) || key.toLowerCase() === "content-length") {
      continue;
    }
    res.setHeader(key, value);
  }
}

async function handleInstanceUiProxy(
  req: IncomingMessage,
  res: ServerResponse,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  route: { pool: InstancePool; id: string; proxiedPath: string },
  url: URL,
): Promise<void> {
  const instance = await ensureInstance(config, deps, route.pool, route.id, false);
  const target = await resolveInstanceProxyTarget(deps, instance);
  const proxyToken = await readInstanceProxyToken(instance);
  const targetUrl = new URL(`http://${target.host}:${target.port}${route.proxiedPath}${url.search}`);
  const method = (req.method ?? "GET").toUpperCase();
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: copyProxyRequestHeaders(
      req.headers,
      target.host,
      target.port,
      {
        ...(proxyToken ? { authorization: `Bearer ${proxyToken}` } : {}),
        ...(req.headers.origin ? { origin: buildInstanceProxyOrigin(target.host, target.port) } : {}),
      },
    ),
    redirect: "manual",
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = req as unknown as BodyInit;
    init.duplex = "half";
  }

  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(targetUrl, init);
  } catch (error) {
    throw new HttpError(
      502,
      error instanceof Error ? error.message : `Failed to proxy request to ${targetUrl}.`,
      "proxy_upstream_failed",
    );
  }
  res.statusCode = response.status;
  copyProxyResponseHeaders(response.headers, res);
  if (!response.body || method === "HEAD") {
    res.end();
    return;
  }
  Readable.fromWeb(response.body).pipe(res);
}

async function handleAdminValidate(
  req: IncomingMessage,
  res: ServerResponse,
  config: SharedConsoleApiConfig,
): Promise<void> {
  if ((req.method ?? "GET").toUpperCase() !== "GET") {
    throw new HttpError(405, "Method Not Allowed", "method_not_allowed");
  }
  requireAdminRequest(config, req);
  sendJson(res, 200, { ok: true, admin: true });
}

async function handleInstanceTokenRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  route: { pool: InstancePool; id: string },
): Promise<void> {
  if ((req.method ?? "GET").toUpperCase() !== "GET") {
    throw new HttpError(405, "Method Not Allowed", "method_not_allowed");
  }
  requireAdminRequest(config, req);
  const instance = await ensureInstance(config, deps, route.pool, route.id, false);
  const token = await readInstanceProxyToken(instance);
  if (!token) {
    throw new HttpError(404, `Instance ${instance.id} does not have a token.`, "not_found");
  }
  sendJson(res, 200, {
    ok: true,
    item: {
      id: instance.id,
      pool: route.pool,
      token,
    },
  });
}

async function applyInstanceModelChannel(
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  pool: InstancePool,
  id: string,
  modelChannelId: string | null | undefined,
): Promise<SharedInstanceRecord> {
  const settings = await readSharedConsoleModelChannelSettings(config.modelChannelsPath);
  const target = resolveSharedConsoleModelChannelTarget(settings, modelChannelId);
  if (modelChannelId && !target) {
    throw new HttpError(400, `Model channel not found: ${modelChannelId}`);
  }
  await updateSharedInstanceEnvValues(resolveInstancesRoot(config, pool), id, {
    INSTANCE_MODEL_CHANNEL_ID: target?.id ?? null,
  });
  const instance = await ensureInstance(config, deps, pool, id, false);
  await writeSharedConsoleInstanceModelConfig(instance, target);
  return await ensureInstance(config, deps, pool, id, false);
}

async function handleModelChannelsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
  const settings = await readSharedConsoleModelChannelSettings(config.modelChannelsPath);
  const admin = isAdminRequest(config, req);
    sendJson(res, 200, {
      ok: true,
      admin,
      catalog: buildSharedConsoleModelChannelCatalog(settings),
      ...(admin ? { settings } : {}),
    });
    return;
  }

  if (method !== "PUT") {
    throw new HttpError(405, "Method Not Allowed", "method_not_allowed");
  }

  requireAdminRequest(config, req);
  const body = await readJsonBody(req);
  const nextSettings = normalizeSharedConsoleModelChannelSettings(body.settings ?? body);
  const instances = await listAllCurrentInstances(config, deps);
  const inUseIds = [...new Set(instances.map((item) => item.modelChannelId).filter(Boolean))];
  const missingIds = inUseIds.filter(
    (channelId) => !resolveSharedConsoleModelChannelTarget(nextSettings, channelId),
  );
  if (missingIds.length > 0) {
    throw new HttpError(
      400,
      `Cannot remove channels that are still assigned to instances: ${missingIds.join(", ")}`,
    );
  }

  await writeSharedConsoleModelChannelSettings(config.modelChannelsPath, nextSettings);
  const affectedInstances: Array<{ id: string; pool: InstancePool; restartRequired: boolean }> = [];
  for (const item of instances) {
    if (!item.modelChannelId) {
      continue;
    }
    const target = resolveSharedConsoleModelChannelTarget(nextSettings, item.modelChannelId);
    if (!target) {
      continue;
    }
    await writeSharedConsoleInstanceModelConfig(item, target);
    affectedInstances.push({
      id: item.id,
      pool: item.paths.root === config.dedicatedInstancesRoot ? "dedicated" : "shared",
      restartRequired: item.process.state === "running",
    });
  }

  sendJson(res, 200, {
    ok: true,
    admin: true,
    catalog: buildSharedConsoleModelChannelCatalog(nextSettings),
    settings: nextSettings,
    meta: {
      affectedInstances,
      restartRequired: affectedInstances.filter((item) => item.restartRequired).map((item) => item.id),
    },
  });
}

function parseJsonCommandStdout(
  result: OpsCommandResult,
  operation: string,
): Record<string, unknown> {
  const raw = result.stdout.trim();
  if (!raw) {
    throw new HttpError(502, `${operation} did not return JSON output.`, "bad_gateway");
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("json must be an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(502, `${operation} returned invalid JSON output.`, "bad_gateway");
  }
}

async function runInstancePairingCommand(
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  route: { pool: InstancePool; id: string },
  action: "list" | "approve-latest",
): Promise<{ result: OpsCommandResult; json: Record<string, unknown> }> {
  const result = await runOpsCommand(config, deps, {
    scriptName: "pairing-instance.sh",
    args: [action, route.id, "--root", resolveInstancesRoot(config, route.pool)],
  });
  return {
    result,
    json: parseJsonCommandStdout(result, `pairing-instance.sh ${action}`),
  };
}

async function handleInstancePairingRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  route: { pool: InstancePool; id: string; action: "list" | "approve-latest" },
): Promise<void> {
  requireAdminRequest(config, req);
  const instance = await ensureInstance(config, deps, route.pool, route.id, false);

  if (route.action === "list") {
    if ((req.method ?? "GET").toUpperCase() !== "GET") {
      throw new HttpError(405, "Method Not Allowed", "method_not_allowed");
    }
    const pairing = await runInstancePairingCommand(config, deps, route, "list");
    sendJson(res, 200, {
      ok: true,
      item: {
        id: instance.id,
        pool: route.pool,
        pairing: pairing.json,
      },
    });
    return;
  }

  if ((req.method ?? "POST").toUpperCase() !== "POST") {
    throw new HttpError(405, "Method Not Allowed", "method_not_allowed");
  }

  const approval = await runInstancePairingCommand(config, deps, route, "approve-latest");
  const pairing = await runInstancePairingCommand(config, deps, route, "list");
  sendJson(res, 200, {
    ok: true,
    action: "approve-latest",
    item: {
      id: instance.id,
      pool: route.pool,
      pairing: pairing.json,
    },
    result: approval.json,
  });
}

function writeUpgradeFailure(socket: Socket, statusCode: number, message: string): void {
  socket.write(
    [
      `HTTP/1.1 ${statusCode} ${statusCode === 404 ? "Not Found" : "Bad Gateway"}`,
      "Connection: close",
      "Content-Type: text/plain; charset=utf-8",
      "",
      message,
    ].join("\r\n"),
  );
  socket.destroy();
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
  const modelChannelId = readOptionalString(body, "modelChannelId");

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
  const instance = await applyInstanceModelChannel(config, deps, pool, id, modelChannelId);
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
  const allowedKeys = new Set(["name", "modelChannelId"]);
  const unsupportedKeys = Object.keys(body).filter((key) => !allowedKeys.has(key));
  if (unsupportedKeys.length > 0) {
    throw new HttpError(
      400,
      `PATCH currently supports only: name, modelChannelId. Unsupported keys: ${unsupportedKeys.join(", ")}`,
    );
  }
  let didChange = false;
  const name = readOptionalString(body, "name");
  if ("name" in body) {
    if (!name) {
      throw new HttpError(400, 'PATCH requires a non-empty "name" when "name" is provided.');
    }
    await updateSharedInstanceName(resolveInstancesRoot(config, pool), id, name);
    didChange = true;
  }
  if ("modelChannelId" in body) {
    const rawChannelId = body.modelChannelId;
    if (rawChannelId != null && typeof rawChannelId !== "string") {
      throw new HttpError(400, '"modelChannelId" must be a string or null.');
    }
    await applyInstanceModelChannel(
      config,
      deps,
      pool,
      id,
      typeof rawChannelId === "string" ? rawChannelId.trim() || null : null,
    );
    didChange = true;
  }
  if (!didChange) {
    throw new HttpError(400, "PATCH requires at least one supported field.");
  }
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

async function handleCreateContainers(
  req: IncomingMessage,
  res: ServerResponse,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
): Promise<void> {
  const body = await readJsonBody(req);
  const names = resolveRequestedContainerNames(body);
  const image = readOptionalString(body, "image") ?? "node:22-bookworm-slim";
  const command = readOptionalString(body, "command");
  const pullMissing = readOptionalBooleanBody(body, "pullMissing", true);
  const env = deps.env ?? process.env;
  const containerRepoRoot = env.OPENCLAW_CONTAINER_REPO_ROOT?.trim() || config.repoRoot;
  const containerSharedRoot =
    env.OPENCLAW_CONTAINER_SHARED_INSTANCES_ROOT?.trim() || config.sharedInstancesRoot;
  const containerDedicatedRoot =
    env.OPENCLAW_CONTAINER_DEDICATED_INSTANCES_ROOT?.trim() || config.dedicatedInstancesRoot;

  const args = [
    ...names.flatMap((name) => ["--name", name]),
    "--image",
    image,
    "--repo-root-host",
    config.repoRoot,
    "--shared-instances-root-host",
    config.sharedInstancesRoot,
    "--dedicated-instances-root-host",
    config.dedicatedInstancesRoot,
    "--repo-root-container",
    containerRepoRoot,
    "--shared-instances-root-container",
    containerSharedRoot,
    "--dedicated-instances-root-container",
    containerDedicatedRoot,
  ];
  if (command) {
    args.push("--command", command);
  }
  if (pullMissing) {
    args.push("--pull-missing");
  }

  const result = await runOpsCommand(config, deps, {
    scriptName: "create-container.sh",
    args,
  });

  const instances = await listAllCurrentInstances(config, deps);
  const snapshot = await listSharedConsoleContainers(instances, {
    listDockerContainers: deps.listDockerContainers,
    includeAllDockerContainers: false,
  });
  const items = names
    .map((name) => snapshot.items.find((item) => item.name === name))
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  sendJson(res, 201, {
    ok: true,
    items,
    request: {
      names,
      image,
      command: command ?? null,
      pullMissing,
    },
    command: {
      scriptName: "create-container.sh",
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
  const proxyWebSocketServer = new WebSocketServer({ noServer: true });

  const server = createServer((req, res) => {
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

        if (url.pathname === "/api/admin/validate") {
          await handleAdminValidate(req, res, config);
          return;
        }

        if (url.pathname === "/api/model-channels") {
          await handleModelChannelsRequest(req, res, config, deps);
          return;
        }

        const instanceUiRoute = parseInstanceUiRoute(url);
        if (instanceUiRoute) {
          await handleInstanceUiProxy(req, res, config, deps, instanceUiRoute, url);
          return;
        }

        const instanceTokenRoute = parseInstanceTokenRoute(url);
        if (instanceTokenRoute) {
          await handleInstanceTokenRequest(req, res, config, deps, instanceTokenRoute);
          return;
        }

        const instancePairingRoute = parseInstancePairingRoute(url);
        if (instancePairingRoute) {
          await handleInstancePairingRequest(req, res, config, deps, instancePairingRoute);
          return;
        }

        const containerRoute = parseContainerRoute(url);
        if (containerRoute) {
          if (containerRoute.kind === "collection") {
            if (req.method === "POST") {
              await handleCreateContainers(req, res, config, deps);
              return;
            }
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

  server.on("upgrade", (req, socket, head) => {
    const hostHeader = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
    const url = new URL(req.url ?? "/", `http://${hostHeader ?? "localhost"}`);
    const route = parseInstanceUiRoute(url);
    if (!route) {
      writeUpgradeFailure(socket, 404, "Not Found");
      return;
    }

    void (async () => {
      try {
        const instance = await ensureInstance(config, deps, route.pool, route.id, false);
        const target = await resolveInstanceProxyTarget(deps, instance);
        const proxyToken = await readInstanceProxyToken(instance);
        const targetUrl = `ws://${target.host}:${target.port}${route.proxiedPath}${url.search}`;
        proxyWebSocketServer.handleUpgrade(req, socket, head, (clientSocket) => {
          const pendingMessages: Array<{ data: Buffer; isBinary: boolean }> = [];
          let targetReady = false;
          const targetSocket = new WebSocket(targetUrl, {
            headers: {
              ...(proxyToken ? { Authorization: `Bearer ${proxyToken}` } : {}),
              Origin: buildInstanceProxyOrigin(target.host, target.port),
            },
          });

          const closeBoth = (code = 1011, reason = "proxy error") => {
            if (
              clientSocket.readyState === WebSocket.OPEN ||
              clientSocket.readyState === WebSocket.CONNECTING
            ) {
              clientSocket.close(code, reason);
            }
            if (
              targetSocket.readyState === WebSocket.OPEN ||
              targetSocket.readyState === WebSocket.CONNECTING
            ) {
              targetSocket.close(code, reason);
            }
          };

          clientSocket.on("message", (data, isBinary) => {
            const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
            if (!targetReady) {
              pendingMessages.push({ data: chunk, isBinary });
              return;
            }
            if (targetSocket.readyState === WebSocket.OPEN) {
              targetSocket.send(chunk, { binary: isBinary });
            }
          });
          clientSocket.on("close", (code, reason) => {
            if (
              targetSocket.readyState === WebSocket.OPEN ||
              targetSocket.readyState === WebSocket.CONNECTING
            ) {
              if (code >= 1000 && code !== 1005 && code !== 1006 && code !== 1015) {
                targetSocket.close(code, Buffer.isBuffer(reason) ? reason.toString() : String(reason ?? ""));
              } else {
                targetSocket.close();
              }
            }
          });
          clientSocket.on("error", () => {
            closeBoth();
          });

          targetSocket.on("open", () => {
            targetReady = true;
            for (const message of pendingMessages.splice(0)) {
              targetSocket.send(message.data, { binary: message.isBinary });
            }
          });
          targetSocket.on("message", (data, isBinary) => {
            if (clientSocket.readyState === WebSocket.OPEN) {
              clientSocket.send(data, { binary: isBinary });
            }
          });
          targetSocket.on("close", (code, reason) => {
            if (
              clientSocket.readyState === WebSocket.OPEN ||
              clientSocket.readyState === WebSocket.CONNECTING
            ) {
              if (code >= 1000 && code !== 1005 && code !== 1006 && code !== 1015) {
                clientSocket.close(code, Buffer.isBuffer(reason) ? reason.toString() : String(reason ?? ""));
              } else {
                clientSocket.close();
              }
            }
          });
          targetSocket.on("error", () => {
            closeBoth();
          });
        });
      } catch (error) {
        writeUpgradeFailure(
          socket,
          error instanceof HttpError && error.statusCode === 404 ? 404 : 502,
          error instanceof Error ? error.message : "Instance UI proxy upgrade failed.",
        );
      }
    })();
  });

  return server;
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
