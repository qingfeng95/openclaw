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
  readSharedInstanceDiagnostics,
  readSharedInstancesUsageSummaryAggregate,
  readSharedInstanceUsageSummary,
  resolveSharedConsoleApiBashPath,
  resolveSharedConsoleDedicatedInstancesRoot,
  updateSharedInstanceEnvValues,
  resolveSharedConsoleInstancesRoot,
  resolveSharedConsoleRepoRoot,
  updateSharedInstanceName,
  validateSharedInstanceId,
  type BuildSharedInstanceDiagnosticsOptions,
  type BuildSharedInstanceRecordOptions,
  type BuildSharedInstanceUsageSummaryOptions,
  type SharedInstanceRecord,
} from "./instances.ts";
import {
  buildSharedConsoleModelChannelCatalog,
  diffSharedConsoleModelChannelSettings,
  generateSharedConsoleModelChannelSettingsDraft,
  normalizeSharedConsoleModelChannelSettings,
  readSharedConsoleModelChannelSettings,
  resolveSharedConsoleModelChannelTarget,
  resolveSharedConsoleModelChannelsPath,
  writeSharedConsoleInstanceModelConfig,
  writeSharedConsoleModelChannelSettings,
} from "./model-channels.ts";
import {
  createAuditEventsRepository,
  createDbClient,
  createInstanceTenantsRepository,
  createTenantsRepository,
} from "./db/index.ts";

const DEFAULT_SHARED_CONSOLE_API_HOST = "127.0.0.1";
const DEFAULT_SHARED_CONSOLE_API_PORT = 43100;
const DEFAULT_SHARED_CONSOLE_API_PROBE_TIMEOUT_MS = 1_500;
const DEFAULT_SHARED_CONSOLE_API_DIAGNOSTICS_CACHE_TTL_MS = 5_000;
const DEFAULT_SHARED_CONSOLE_TENANT_MAPPING_PATH = ".shared-console-tenants.json";
const DEFAULT_SHARED_CONSOLE_TENANT_ID = "internal";

type SharedConsoleTenantMapping = {
  defaultTenantId: string;
  instances: Record<string, string>;
};

function normalizeTenantId(value: unknown, fallback = DEFAULT_SHARED_CONSOLE_TENANT_ID): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || fallback;
}

function normalizeTenantMapping(value: unknown): SharedConsoleTenantMapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      defaultTenantId: DEFAULT_SHARED_CONSOLE_TENANT_ID,
      instances: {},
    };
  }
  const record = value as Record<string, unknown>;
  const defaultTenantId = normalizeTenantId(record.defaultTenantId);
  const instances: Record<string, string> = {};
  const rawInstances = record.instances;
  if (rawInstances && typeof rawInstances === "object" && !Array.isArray(rawInstances)) {
    for (const [instanceId, tenantId] of Object.entries(rawInstances as Record<string, unknown>)) {
      const normalizedInstanceId = String(instanceId || "").trim();
      const normalizedTenantId = normalizeTenantId(tenantId, defaultTenantId);
      if (normalizedInstanceId) {
        instances[normalizedInstanceId] = normalizedTenantId;
      }
    }
  }
  return { defaultTenantId, instances };
}

async function readSharedConsoleTenantMapping(
  tenantMappingPath: string,
): Promise<SharedConsoleTenantMapping> {
  try {
    const raw = await fs.readFile(tenantMappingPath, "utf8");
    return normalizeTenantMapping(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { defaultTenantId: DEFAULT_SHARED_CONSOLE_TENANT_ID, instances: {} };
    }
    throw error;
  }
}

function resolveInstanceTenantId(instanceId: string, mapping: SharedConsoleTenantMapping): string {
  return mapping.instances[instanceId]?.trim() || mapping.defaultTenantId || DEFAULT_SHARED_CONSOLE_TENANT_ID;
}

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
  tenantMappingPath: string;
  databaseUrl: string;
  bashPath: string;
  probeTimeoutMs: number;
  diagnosticsCacheTtlMs: number;
  adminToken: string | null;
  corsAllowedOrigins: string[];
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

function parseCorsAllowedOrigins(value: string | undefined): string[] {
  const origins = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return origins && origins.length > 0 ? origins : [];
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
    tenantMappingPath: path.resolve(
      env.SHARED_CONSOLE_TENANT_MAPPING_PATH?.trim() ||
        path.join(repoRoot, DEFAULT_SHARED_CONSOLE_TENANT_MAPPING_PATH),
    ),
    databaseUrl: env.DATABASE_URL?.trim() || "",
    bashPath: resolveSharedConsoleApiBashPath(env),
    probeTimeoutMs: parsePositiveInteger(
      env.SHARED_CONSOLE_API_PROBE_TIMEOUT_MS,
      DEFAULT_SHARED_CONSOLE_API_PROBE_TIMEOUT_MS,
    ),
    diagnosticsCacheTtlMs: parsePositiveInteger(
      env.SHARED_CONSOLE_API_DIAGNOSTICS_CACHE_TTL_MS,
      DEFAULT_SHARED_CONSOLE_API_DIAGNOSTICS_CACHE_TTL_MS,
    ),
    adminToken: env.SHARED_CONSOLE_ADMIN_TOKEN?.trim() || null,
    corsAllowedOrigins: (env.SHARED_CONSOLE_API_CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function resolveAllowedCorsOrigin(
  req: IncomingMessage,
  allowedOrigins: string[],
): string | null {
  if (allowedOrigins.length === 0) {
    return null;
  }
  const origin = req.headers.origin?.trim() ?? "";
  if (!origin || !allowedOrigins.includes(origin)) {
    return null;
  }
  return origin;
}

function setCorsHeaders(
  req: IncomingMessage | null,
  res: ServerResponse,
  allowedOrigins: string[],
): void {
  const allowedOrigin = req ? resolveAllowedCorsOrigin(req, allowedOrigins) : null;
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Shared-Console-Admin-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
}

function sendJson(
  req: IncomingMessage | null,
  res: ServerResponse,
  statusCode: number,
  body: JsonValue,
  allowedOrigins: string[] = [],
): void {
  setCorsHeaders(req, res, allowedOrigins);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendError(
  req: IncomingMessage | null,
  res: ServerResponse,
  statusCode: number,
  message: string,
  errorType = "invalid_request",
  allowedOrigins: string[] = [],
): void {
  sendJson(
    req,
    res,
    statusCode,
    {
      ok: false,
      error: {
        type: errorType,
        message,
      },
    },
    allowedOrigins,
  );
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

function parseNamedInstanceDiagnosticsRoute(
  url: URL,
  basePath: string,
  pool: InstancePool,
): { pool: InstancePool; id: string } | null {
  const match = url.pathname.match(new RegExp(`^${basePath}/([^/]+)/diagnostics$`));
  if (!match) {
    return null;
  }
  return {
    pool,
    id: decodeURIComponent(match[1] ?? ""),
  };
}

function parseInstanceDiagnosticsRoute(url: URL) {
  return (
    parseNamedInstanceDiagnosticsRoute(url, "/api/instances", "shared") ??
    parseNamedInstanceDiagnosticsRoute(url, "/api/shared-instances", "shared") ??
    parseNamedInstanceDiagnosticsRoute(url, "/api/dedicated-instances", "dedicated")
  );
}

function parseNamedCollectionUsageSummaryRoute(
  url: URL,
  basePath: string,
  pool: InstancePool,
): { pool: InstancePool } | null {
  if (url.pathname !== `${basePath}/usage-summary`) {
    return null;
  }
  return { pool };
}

function parseCollectionUsageSummaryRoute(url: URL) {
  return (
    parseNamedCollectionUsageSummaryRoute(url, "/api/instances", "shared") ??
    parseNamedCollectionUsageSummaryRoute(url, "/api/shared-instances", "shared") ??
    parseNamedCollectionUsageSummaryRoute(url, "/api/dedicated-instances", "dedicated")
  );
}

async function handleCollectionUsageSummaryRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  route: { pool: InstancePool },
): Promise<void> {
  if ((req.method ?? "GET").toUpperCase() !== "GET") {
    throw new HttpError(405, "Method Not Allowed", "method_not_allowed");
  }
  const items = await listSharedInstances(
    resolveInstancesRoot(config, route.pool),
    resolveRecordOptions(config, deps, false),
  );
  const result = await readSharedInstancesUsageSummaryAggregate(items, resolveUsageSummaryOptions(config, deps));
  sendJson(req, res, 200, {
    ok: true,
    item: {
      pool: route.pool,
      usageSummary: result.usageSummary,
      checkedAt: result.checkedAt,
      instanceCount: result.instanceCount,
      reportedInstanceCount: result.reportedInstanceCount,
    },
  });
}

function parseNamedInstanceUsageSummaryRoute(
  url: URL,
  basePath: string,
  pool: InstancePool,
): { pool: InstancePool; id: string } | null {
  const match = url.pathname.match(new RegExp(`^${basePath}/([^/]+)/usage-summary$`));
  if (!match) {
    return null;
  }
  return {
    pool,
    id: decodeURIComponent(match[1] ?? ""),
  };
}

function parseInstanceUsageSummaryRoute(url: URL) {
  return (
    parseNamedInstanceUsageSummaryRoute(url, "/api/instances", "shared") ??
    parseNamedInstanceUsageSummaryRoute(url, "/api/shared-instances", "shared") ??
    parseNamedInstanceUsageSummaryRoute(url, "/api/dedicated-instances", "dedicated")
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

function resolveDiagnosticsOptions(
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
): BuildSharedInstanceDiagnosticsOptions {
  return {
    fetchImpl: deps.fetchImpl,
    probeTimeoutMs: config.probeTimeoutMs,
    cacheTtlMs: config.diagnosticsCacheTtlMs,
    runContainerProbe: resolveRecordOptions(config, deps, true).runContainerProbe,
  };
}

function resolveUsageSummaryOptions(
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
): BuildSharedInstanceUsageSummaryOptions {
  return {
    fetchImpl: deps.fetchImpl,
    probeTimeoutMs: config.probeTimeoutMs,
    cacheTtlMs: config.diagnosticsCacheTtlMs,
    runContainerProbe: resolveRecordOptions(config, deps, true).runContainerProbe,
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

async function handleInstanceDiagnosticsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  route: { pool: InstancePool; id: string },
): Promise<void> {
  if ((req.method ?? "GET").toUpperCase() !== "GET") {
    throw new HttpError(405, "Method Not Allowed", "method_not_allowed");
  }
  const refreshRequested = readBooleanQuery(new URL(req.url || "", "http://localhost"), "refresh", false);
  enforceRateLimit(`instance.diagnostics:${route.pool}`);
  const item = await ensureInstance(config, deps, route.pool, route.id, false);
  const probe = await readSharedInstanceDiagnostics(item, {
    ...resolveDiagnosticsOptions(config, deps),
    cacheTtlMs: refreshRequested ? 0 : config.diagnosticsCacheTtlMs,
  });
  await logAuditEvent({
    actor: readRequestActor(config, req),
    action: "instance.diagnostics.read",
    target: item.id,
    pool: route.pool,
    requestId: readRequestId(req),
    result: "success",
  });
  sendJson(req, res, 200, {
    ok: true,
    item: {
      id: item.id,
      pool: route.pool,
      probe,
    },
  }, config.corsAllowedOrigins);
}

async function handleInstanceUsageSummaryRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  route: { pool: InstancePool; id: string },
): Promise<void> {
  if ((req.method ?? "GET").toUpperCase() !== "GET") {
    throw new HttpError(405, "Method Not Allowed", "method_not_allowed");
  }
  enforceRateLimit(`instance.usage-summary:${route.pool}`);
  const item = await ensureInstance(config, deps, route.pool, route.id, false);
  const result = await readSharedInstanceUsageSummary(item, resolveUsageSummaryOptions(config, deps));
  await logAuditEvent({
    actor: readRequestActor(config, req),
    action: "instance.usage-summary.read",
    target: item.id,
    pool: route.pool,
    requestId: readRequestId(req),
    result: "success",
  });
  sendJson(req, res, 200, {
    ok: true,
    item: {
      id: item.id,
      pool: route.pool,
      usageSummary: result.usageSummary,
      checkedAt: result.checkedAt,
      ...(result.error ? { error: result.error } : {}),
    },
  }, config.corsAllowedOrigins);
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

function readRequestActor(config: SharedConsoleApiConfig, req: IncomingMessage): string {
  return isAdminRequest(config, req) ? "admin" : "anonymous";
}

function readRequestId(req: IncomingMessage): string | undefined {
  const raw = req.headers["x-request-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

async function logAuditEvent(
  event: {
    actor: string;
    action: string;
    target?: string;
    tenantId?: string | null;
    pool?: InstancePool;
    requestId?: string;
    result: "success" | "error";
    error?: string;
  },
  repositories?: {
    auditEventsRepository: ReturnType<typeof createAuditEventsRepository> | null;
  },
): Promise<void> {
  const payload = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  process.stdout.write(`[audit] ${JSON.stringify(payload)}\n`);
  if (repositories?.auditEventsRepository) {
    try {
      await repositories.auditEventsRepository.writeAuditEvent({
        actor: event.actor,
        action: event.action,
        target: event.target ?? null,
        tenantId: event.tenantId ?? null,
        pool: event.pool ?? null,
        requestId: event.requestId,
        result: event.result,
        error: event.error ?? null,
      });
    } catch (error) {
      process.stdout.write(`[audit] ${JSON.stringify({
        timestamp: new Date().toISOString(),
        actor: "system",
        action: "audit.persist",
        result: "error",
        error: error instanceof Error ? error.message : String(error),
      })}\n`);
    }
  }
}

function trackRequestMetrics(route: string, statusCode: number, durationMs: number): void {
  requestMetricsState.totalCount += 1;
  if (statusCode >= 400) {
    requestMetricsState.errorCount += 1;
  }
  requestMetricsState.byStatusCode.set(statusCode, (requestMetricsState.byStatusCode.get(statusCode) ?? 0) + 1);
  const current = requestMetricsState.byRoute.get(route) ?? { count: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  requestMetricsState.byRoute.set(route, current);
}

const requestRateLimitState = new Map<string, { count: number; resetAt: number }>();
const instanceWriteLockState = new Map<string, Promise<void>>();
const requestMetricsState = {
  totalCount: 0,
  errorCount: 0,
  byStatusCode: new Map<number, number>(),
  byRoute: new Map<string, { count: number; totalMs: number; maxMs: number }>(),
};

function enforceRateLimit(key: string, limit = 30, windowMs = 60_000): void {
  const now = Date.now();
  const current = requestRateLimitState.get(key);
  if (!current || current.resetAt <= now) {
    requestRateLimitState.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= limit) {
    throw new HttpError(429, "Too Many Requests", "rate_limited");
  }
  current.count += 1;
  requestRateLimitState.set(key, current);
}

async function withInstanceWriteLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  while (instanceWriteLockState.has(key)) {
    await instanceWriteLockState.get(key);
  }
  let release!: () => void;
  const lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  instanceWriteLockState.set(key, lock);
  try {
    return await run();
  } finally {
    release();
    if (instanceWriteLockState.get(key) === lock) {
      instanceWriteLockState.delete(key);
    }
  }
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

function getRequestOrigin(req: IncomingMessage): string {
  return typeof req.headers.origin === "string" ? req.headers.origin.trim() : "";
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
  enforceRateLimit("admin.validate");
  requireAdminRequest(config, req);
  await logAuditEvent({
    actor: readRequestActor(config, req),
    action: "admin.validate",
    result: "success",
  });
  sendJson(req, res, 200, { ok: true, admin: true }, config.corsAllowedOrigins);
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
  enforceRateLimit(`instance.token.read:${route.pool}`);
  enforceRateLimit(`instance.pairing:${route.pool}`);
  requireAdminRequest(config, req);
  const instance = await ensureInstance(config, deps, route.pool, route.id, false);
  const token = await readInstanceProxyToken(instance);
  if (!token) {
    throw new HttpError(404, `Instance ${instance.id} does not have a token.`, "not_found");
  }
  await logAuditEvent({
    actor: readRequestActor(config, req),
    action: "instance.token.read",
    target: instance.id,
    pool: route.pool,
    result: "success",
  });
  sendJson(req, res, 200, {
    ok: true,
    item: {
      id: instance.id,
      pool: route.pool,
      token,
    },
  }, config.corsAllowedOrigins);
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

function resolveInstancePoolForRecord(
  config: SharedConsoleApiConfig,
  item: SharedInstanceRecord,
): InstancePool {
  return item.paths.root === config.dedicatedInstancesRoot ? "dedicated" : "shared";
}

async function handleModelChannelsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  enforceRateLimit("model-channels.read");
  if (method === "GET") {
    const settings = await readSharedConsoleModelChannelSettings(config.modelChannelsPath);
    const admin = isAdminRequest(config, req);
    sendJson(req, res, 200, {
      ok: true,
      admin,
      catalog: buildSharedConsoleModelChannelCatalog(settings),
      ...(admin ? { settings } : {}),
    }, config.corsAllowedOrigins);
    return;
  }

  if (method !== "PUT") {
    throw new HttpError(405, "Method Not Allowed", "method_not_allowed");
  }

  enforceRateLimit("model-channels.write");
  requireAdminRequest(config, req);
  const body = await readJsonBody(req);
  const autoUnassignRemovedChannels = readOptionalBooleanBody(
    body,
    "autoUnassignRemovedChannels",
    false,
  );
  const beforeSettings = await readSharedConsoleModelChannelSettings(config.modelChannelsPath);
  const nextSettings = normalizeSharedConsoleModelChannelSettings(body.settings ?? body);
  const settingsDiff = diffSharedConsoleModelChannelSettings(beforeSettings, nextSettings);
  const instances = await listAllCurrentInstances(config, deps);
  const inUseIds = [...new Set(instances.map((item) => item.modelChannelId).filter(Boolean))];
  const missingIds = inUseIds.filter(
    (channelId) => !resolveSharedConsoleModelChannelTarget(nextSettings, channelId),
  );
  if (missingIds.length > 0) {
    if (!autoUnassignRemovedChannels) {
      throw new HttpError(
        400,
        `Cannot remove channels that are still assigned to instances: ${missingIds.join(", ")}`,
      );
    }
  }

  await writeSharedConsoleModelChannelSettings(config.modelChannelsPath, nextSettings);
  const removedIdSet = new Set(missingIds);
  const unassignedInstances: Array<{
    id: string;
    pool: InstancePool;
    removedModelChannelId: string;
    restartRequired: boolean;
  }> = [];
  for (const item of instances) {
    if (!item.modelChannelId || !removedIdSet.has(item.modelChannelId)) {
      continue;
    }
    await applyInstanceModelChannel(
      config,
      deps,
      resolveInstancePoolForRecord(config, item),
      item.id,
      null,
    );
    unassignedInstances.push({
      id: item.id,
      pool: resolveInstancePoolForRecord(config, item),
      removedModelChannelId: item.modelChannelId,
      restartRequired: item.process.state === "running",
    });
  }

  const currentInstances = await listAllCurrentInstances(config, deps);
  const affectedInstances: Array<{ id: string; pool: InstancePool; restartRequired: boolean }> = [];
  for (const item of currentInstances) {
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
      pool: resolveInstancePoolForRecord(config, item),
      restartRequired: item.process.state === "running",
    });
  }

  const restartRequired = [
    ...new Set(
      [...affectedInstances, ...unassignedInstances]
        .filter((item) => item.restartRequired)
        .map((item) => item.id),
    ),
  ];
  const changeSummary = {
    ...settingsDiff,
    affectedInstanceIds: affectedInstances.map((item) => item.id),
    unassignedInstanceIds: unassignedInstances.map((item) => item.id),
    restartRequired,
  };

  await logAuditEvent({
    actor: readRequestActor(config, req),
    action: "model-channels.update",
    target: "model-channels",
    requestId: readRequestId(req),
    result: "success",
  });

  sendJson(req, res, 200, {
    ok: true,
    admin: true,
    catalog: buildSharedConsoleModelChannelCatalog(nextSettings),
    settings: nextSettings,
    meta: {
      changeSummary,
      affectedInstances,
      unassignedInstances,
      restartRequired,
    },
  }, config.corsAllowedOrigins);
}

async function handleTenantRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  repositories: {
    tenantsRepository: ReturnType<typeof createTenantsRepository> | null;
    instanceTenantsRepository: ReturnType<typeof createInstanceTenantsRepository> | null;
  },
): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
    const rawTenants = repositories.tenantsRepository ? await repositories.tenantsRepository.listTenants() : [];
    const rawInstanceTenants = repositories.instanceTenantsRepository
      ? await repositories.instanceTenantsRepository.listInstanceTenants()
      : [];
    const tenants = Array.isArray(rawTenants) ? rawTenants : [];
    const instanceTenants = Array.isArray(rawInstanceTenants) ? rawInstanceTenants : [];

    process.stdout.write(
      `[shared-console-api][tenants] rawTenants=${typeof rawTenants} isArray=${Array.isArray(rawTenants)} rawInstanceTenants=${typeof rawInstanceTenants} isArray=${Array.isArray(rawInstanceTenants)} tenantsLength=${tenants.length} instanceTenantsLength=${instanceTenants.length}\n`,
    );

    if (tenants.length > 0 || instanceTenants.length > 0) {
      const instances = Object.fromEntries(instanceTenants.map((item) => [item.instanceId, item.tenantId]));
      const defaultTenantId = tenants.find((item) => item.id === DEFAULT_SHARED_CONSOLE_TENANT_ID)?.id ?? DEFAULT_SHARED_CONSOLE_TENANT_ID;
      sendJson(req, res, 200, {
        ok: true,
        source: "database",
        defaultTenantId,
        instances,
        tenants,
        instanceTenants,
      }, config.corsAllowedOrigins);
      return;
    }

    const mapping = await readSharedConsoleTenantMapping(config.tenantMappingPath);
    const instances = mapping && typeof mapping.instances === "object" && !Array.isArray(mapping.instances)
      ? mapping.instances
      : {};
    process.stdout.write(
      `[shared-console-api][tenants] fallback mapping defaultTenantId=${mapping.defaultTenantId} instancesType=${typeof mapping.instances} instancesIsArray=${Array.isArray(mapping.instances)}\n`,
    );
    sendJson(req, res, 200, {
      ok: true,
      source: "file",
      defaultTenantId: mapping.defaultTenantId,
      instances,
      tenants,
      instanceTenants,
    }, config.corsAllowedOrigins);
    return;
  }

  if (method !== "PUT") {
    throw new HttpError(405, "Method Not Allowed", "method_not_allowed");
  }

  requireAdminRequest(config, req);
  const body = await readJsonBody(req);
  const nextMapping = normalizeTenantMapping(body);
  if (repositories.tenantsRepository && repositories.instanceTenantsRepository) {
    await repositories.tenantsRepository.upsertTenant({
      id: nextMapping.defaultTenantId,
      name: nextMapping.defaultTenantId,
      description: null,
      status: "active",
    });
    for (const [instanceId, tenantId] of Object.entries(nextMapping.instances)) {
      await repositories.tenantsRepository.upsertTenant({
        id: tenantId,
        name: tenantId,
        description: null,
        status: "active",
      });
      await repositories.instanceTenantsRepository.setInstanceTenant(instanceId, tenantId, "api");
    }
  }
  await fs.writeFile(config.tenantMappingPath, `${JSON.stringify(nextMapping, null, 2)}\n`, "utf8");
  sendJson(req, res, 200, {
    ok: true,
    source: "database",
    defaultTenantId: nextMapping.defaultTenantId,
    instances: nextMapping.instances,
  }, config.corsAllowedOrigins);
}

async function handleModelChannelsGenerateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: SharedConsoleApiConfig,
): Promise<void> {
  if ((req.method ?? "GET").toUpperCase() !== "POST") {
    throw new HttpError(405, "Method Not Allowed", "method_not_allowed");
  }

  requireAdminRequest(config, req);
  const body = await readJsonBody(req);
  const currentSettings =
    body.settings ?? (await readSharedConsoleModelChannelSettings(config.modelChannelsPath));
  const generated = generateSharedConsoleModelChannelSettingsDraft(currentSettings, body.generator ?? body);
  sendJson(req, res, 200, {
    ok: true,
    admin: true,
    catalog: buildSharedConsoleModelChannelCatalog(generated.settings),
    settings: generated.settings,
    meta: generated.meta,
  }, config.corsAllowedOrigins);
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
    await logAuditEvent({
      actor: readRequestActor(config, req),
      action: "instance.pairing.list",
      target: instance.id,
      pool: route.pool,
      result: "success",
    });
    sendJson(req, res, 200, {
      ok: true,
      item: {
        id: instance.id,
        pool: route.pool,
        pairing: pairing.json,
      },
    }, config.corsAllowedOrigins);
    return;
  }

  if ((req.method ?? "POST").toUpperCase() !== "POST") {
    throw new HttpError(405, "Method Not Allowed", "method_not_allowed");
  }

  const approval = await runInstancePairingCommand(config, deps, route, "approve-latest");
  const pairing = await runInstancePairingCommand(config, deps, route, "list");
  await logAuditEvent({
    actor: readRequestActor(config, req),
    action: "instance.pairing.approve-latest",
    target: instance.id,
    pool: route.pool,
    result: "success",
  });
  sendJson(req, res, 200, {
    ok: true,
    action: "approve-latest",
    item: {
      id: instance.id,
      pool: route.pool,
      pairing: pairing.json,
    },
    result: approval.json,
  }, config.corsAllowedOrigins);
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
  await withInstanceWriteLock(`instance:${pool}:${id}`, async () => {
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
    sendJson(req, res, 201, {
      ok: true,
      pool,
      item: instance,
      command: {
        scriptName: "create-instance.sh",
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      },
    }, config.corsAllowedOrigins);
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
  await withInstanceWriteLock(`instance:${pool}:${id}`, async () => {
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
    sendJson(req, res, 200, {
      ok: true,
      item: instance,
    }, config.corsAllowedOrigins);
  });
}

async function handleAction(
  req: IncomingMessage,
  res: ServerResponse,
  config: SharedConsoleApiConfig,
  deps: SharedConsoleApiDeps,
  pool: InstancePool,
  id: string,
  action: "start" | "stop" | "restart",
): Promise<void> {
  await ensureInstance(config, deps, pool, id, false);
  await withInstanceWriteLock(`instance:${pool}:${id}`, async () => {
    const result = await runOpsCommand(config, deps, {
      scriptName: `${action}-instance.sh`,
      args: [id, "--root", resolveInstancesRoot(config, pool)],
    });
    const instance = await ensureInstance(config, deps, pool, id, action !== "stop");
    sendJson(req, res, 200, {
      ok: true,
      action,
      item: instance,
      command: {
        scriptName: `${action}-instance.sh`,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      },
    }, config.corsAllowedOrigins);
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
    restartInstances: async (containerName, instanceIds) => {
      for (const instanceId of instanceIds) {
        const instance = instances.find((inst) => inst.id === instanceId);
        if (!instance) {
          continue;
        }
        const pool = instance.pool === "dedicated" ? "dedicated" : "shared";
        await runOpsCommand(config, deps, {
          scriptName: "restart-instance.sh",
          args: [instanceId, "--root", resolveInstancesRoot(config, pool)],
        });
      }
    },
  });
  sendJson(req, res, 200, {
    ok: true,
    action,
    item: result.container,
    command: {
      engine: "docker",
      stdout: result.command.stdout.trim(),
      stderr: result.command.stderr.trim(),
      exitCode: result.command.exitCode,
    },
    restartedInstances: result.restartedInstances,
  }, config.corsAllowedOrigins);
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
  sendJson(req, res, 200, {
    ok: true,
    item: result.container,
    logs: {
      tail: result.tail,
      text: result.text,
    },
  }, config.corsAllowedOrigins);
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

  await withInstanceWriteLock(`containers:${names.join(",")}`, async () => {
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

    sendJson(req, res, 201, {
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
    }, config.corsAllowedOrigins);
  });
}

export function createSharedConsoleApiServer(deps: SharedConsoleApiDeps = {}): Server {
  const config = {
    ...resolveSharedConsoleApiConfig(deps.env),
    ...deps.config,
  };
  const db = config.databaseUrl ? createDbClient({ databaseUrl: config.databaseUrl }) : null;
  const tenantsRepository = db ? createTenantsRepository({ db }) : null;
  const instanceTenantsRepository = db ? createInstanceTenantsRepository({ db }) : null;
  const auditEventsRepository = db ? createAuditEventsRepository({ db }) : null;
  const proxyWebSocketServer = new WebSocketServer({ noServer: true });

  const server = createServer((req, res) => {
    const startedAt = Date.now();
    const routeLabel = `${(req.method ?? "GET").toUpperCase()} ${new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname}`;
    void (async () => {
      try {
        setCorsHeaders(res);
        if ((req.method ?? "GET").toUpperCase() === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          trackRequestMetrics(routeLabel, 204, Date.now() - startedAt);
          return;
        }

        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        if (url.pathname === "/healthz") {
          sendJson(req, res, 200, { ok: true, status: "live" }, config.corsAllowedOrigins);
          trackRequestMetrics(routeLabel, 200, Date.now() - startedAt);
          return;
        }
        if (url.pathname === "/metrics") {
          const metricsPayload = {
            ok: true,
            totalCount: requestMetricsState.totalCount,
            errorCount: requestMetricsState.errorCount,
            byStatusCode: Object.fromEntries(requestMetricsState.byStatusCode.entries()),
            byRoute: Object.fromEntries(
              [...requestMetricsState.byRoute.entries()].map(([key, value]) => [key, {
                count: value.count,
                averageMs: value.count > 0 ? Math.round(value.totalMs / value.count) : 0,
                maxMs: value.maxMs,
              }]),
            ),
          };
          sendJson(req, res, 200, metricsPayload, config.corsAllowedOrigins);
          trackRequestMetrics(routeLabel, 200, Date.now() - startedAt);
          return;
        }

        if (url.pathname === "/api/admin/validate") {
          await handleAdminValidate(req, res, config);
          return;
        }

        if (url.pathname === "/api/model-channels/generate") {
          await handleModelChannelsGenerateRequest(req, res, config);
          return;
        }

        if (url.pathname === "/api/tenants") {
          await handleTenantRequest(req, res, config, deps, {
            tenantsRepository,
            instanceTenantsRepository,
          });
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

        const instanceDiagnosticsRoute = parseInstanceDiagnosticsRoute(url);
        if (instanceDiagnosticsRoute) {
          await handleInstanceDiagnosticsRequest(req, res, config, deps, instanceDiagnosticsRoute);
          return;
        }

        const collectionUsageSummaryRoute = parseCollectionUsageSummaryRoute(url);
        if (collectionUsageSummaryRoute) {
          await handleCollectionUsageSummaryRequest(req, res, config, deps, collectionUsageSummaryRoute);
          return;
        }

        const instanceUsageSummaryRoute = parseInstanceUsageSummaryRoute(url);
        if (instanceUsageSummaryRoute) {
          await handleInstanceUsageSummaryRequest(req, res, config, deps, instanceUsageSummaryRoute);
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
              sendError(req, res, 405, "Method Not Allowed", "method_not_allowed");
              return;
            }
            const instances = await listAllCurrentInstances(config, deps);
            const snapshot = await listSharedConsoleContainers(instances, {
              listDockerContainers: deps.listDockerContainers,
              includeAllDockerContainers: readBooleanQuery(url, "all", false),
            });
            sendJson(req, res, 200, {
              ok: true,
              items: snapshot.items,
              meta: snapshot.meta,
            }, config.corsAllowedOrigins);
            return;
          }

          if (containerRoute.kind === "logs") {
            if (req.method !== "GET") {
              sendError(req, res, 405, "Method Not Allowed", "method_not_allowed", config.corsAllowedOrigins);
              return;
            }
            await handleContainerLogs(res, url, config, deps, containerRoute.id);
            return;
          }

          if (req.method !== "POST") {
            sendError(req, res, 405, "Method Not Allowed", "method_not_allowed", config.corsAllowedOrigins);
            return;
          }
          await handleContainerAction(res, config, deps, containerRoute.id, containerRoute.action);
          return;
        }

        const route = parseInstanceRoute(url);
        if (!route) {
          sendError(req, res, 404, "Not Found", "not_found", config.corsAllowedOrigins);
          return;
        }

        if (route.kind === "collection") {
          if (req.method === "GET") {
            const includeProbe = readBooleanQuery(url, "includeProbe", false);
            const items = await listSharedInstances(
              resolveInstancesRoot(config, route.pool),
              resolveRecordOptions(config, deps, includeProbe),
            );
            sendJson(req, res, 200, {
              ok: true,
              items,
              meta: {
                pool: route.pool,
                instancesRoot: resolveInstancesRoot(config, route.pool),
                includeProbe,
              },
            }, config.corsAllowedOrigins);
            return;
          }
          if (req.method === "POST") {
            await handleCreateInstance(req, res, config, deps, route.pool);
            return;
          }
          sendError(req, res, 405, "Method Not Allowed", "method_not_allowed", config.corsAllowedOrigins);
          return;
        }

        if (route.kind === "item") {
          if (req.method === "GET") {
            const includeProbe = readBooleanQuery(url, "includeProbe", false);
            const item = await ensureInstance(config, deps, route.pool, route.id, includeProbe);
            sendJson(req, res, 200, {
              ok: true,
              item,
            }, config.corsAllowedOrigins);
            return;
          }
          if (req.method === "PATCH") {
            await handlePatchInstance(req, res, config, deps, route.pool, route.id);
            return;
          }
          sendError(req, res, 405, "Method Not Allowed", "method_not_allowed", config.corsAllowedOrigins);
          return;
        }

        if (req.method !== "POST") {
          sendError(req, res, 405, "Method Not Allowed", "method_not_allowed", config.corsAllowedOrigins);
          return;
        }
        await handleAction(req, res, config, deps, route.pool, route.id, route.action);
      } catch (error) {
        if (error instanceof HttpError) {
          sendError(req, res, error.statusCode, error.message, error.errorType, config.corsAllowedOrigins);
          return;
        }
        if (error instanceof OpsCommandError) {
          sendJson(req, res, 502, {
            ok: false,
            error: {
              type: "ops_command_failed",
              message: error.message,
              scriptName: error.invocation.scriptName,
              stdout: error.result.stdout.trim(),
              stderr: error.result.stderr.trim(),
              exitCode: error.result.exitCode,
            },
          }, config.corsAllowedOrigins);
          return;
        }
        sendError(
          req,
          res,
          500,
          error instanceof Error ? error.message : "Internal Server Error",
          "internal_error",
          config.corsAllowedOrigins,
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
