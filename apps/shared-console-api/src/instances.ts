import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SharedInstanceProcessState = "running" | "stopped";

export type SharedUsageSummaryPayload = {
  totalCount?: number;
  countsByOutcome?: Record<string, number>;
  countsByToolName?: Record<string, number>;
  countsByToolNameAction?: Record<string, number>;
  countsByRouteType?: Record<string, number>;
  countsByRuleId?: Record<string, number>;
  countsByDeniedReason?: Record<string, number>;
  filePath?: string;
  note?: string;
  [key: string]: unknown;
};

export type SharedInstanceProbe = {
  checkedAt: string;
  live: boolean | null;
  ready: boolean | null;
  version: string | null;
  usageSummary: SharedUsageSummaryPayload | null;
  error?: string;
};

export type SharedInstanceUsageSummaryResult = {
  checkedAt: string;
  usageSummary: SharedUsageSummaryPayload | null;
  error?: string;
};

export type SharedInstancesUsageSummaryAggregateResult = {
  checkedAt: string;
  usageSummary: SharedUsageSummaryPayload | null;
  instanceCount: number;
  reportedInstanceCount: number;
};

export type SharedInstanceRecord = {
  id: string;
  name: string;
  modelChannelId: string | null;
  bind: string | null;
  port: number | null;
  profile: string | null;
  template: string | null;
  runtime: {
    location: "host" | "container";
    containerName: string | null;
    containerId: string | null;
  };
  paths: {
    root: string;
    dir: string;
    configPath: string | null;
    stateDir: string | null;
    logDir: string | null;
    runDir: string | null;
    pidFile: string | null;
  };
  process: {
    state: SharedInstanceProcessState;
    pid: number | null;
  };
  timestamps: {
    createdAt: string;
    updatedAt: string;
  };
  probe: SharedInstanceProbe | null;
};

export type BuildSharedInstanceRecordOptions = {
  fetchImpl?: typeof fetch;
  includeProbe?: boolean;
  probeTimeoutMs?: number;
  runContainerProbe?: (
    instance: SharedInstanceRecord,
    request: {
      path: string;
      timeoutMs: number;
    },
  ) => Promise<unknown>;
};

export type BuildSharedInstanceDiagnosticsOptions = Omit<
  BuildSharedInstanceRecordOptions,
  "includeProbe"
> & {
  cacheTtlMs?: number;
};

export type BuildSharedInstanceUsageSummaryOptions = Omit<
  BuildSharedInstanceRecordOptions,
  "includeProbe"
> & {
  cacheTtlMs?: number;
};

type InstanceEnvRecord = Record<string, string>;

const DEFAULT_PROBE_TIMEOUT_MS = 1_500;
const DEFAULT_DIAGNOSTICS_CACHE_TTL_MS = 5_000;
const GIT_BASH_WINDOWS_PATH = "C:\\Program Files\\Git\\bin\\bash.exe";
const diagnosticsCache = new Map<
  string,
  { expiresAt: number; probe: SharedInstanceProbe }
>();
const usageSummaryCache = new Map<
  string,
  { expiresAt: number; result: SharedInstanceUsageSummaryResult }
>();

function stripWrappingQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replace(/\\\\/g, "\\")
      .replace(/\\"/g, '"');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function parseInstanceEnv(content: string): InstanceEnvRecord {
  const parsed: InstanceEnvRecord = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    parsed[key] = stripWrappingQuotes(rawValue);
  }
  return parsed;
}

function normalizeNullableString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeNullableNumber(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPidValue(value: string | undefined): number | null {
  const pid = normalizeNullableNumber(value);
  return pid && pid > 0 ? pid : null;
}

function resolveInstanceRuntime(envRecord: InstanceEnvRecord): {
  location: "host" | "container";
  containerName: string | null;
  containerId: string | null;
} {
  const runtimeKind = envRecord.INSTANCE_RUNTIME_KIND?.trim().toLowerCase();
  const containerName = normalizeNullableString(
    envRecord.INSTANCE_CONTAINER_NAME ?? envRecord.OPENCLAW_CONTAINER,
  );
  const containerId = normalizeNullableString(envRecord.INSTANCE_CONTAINER_ID);
  if (runtimeKind === "container" || containerName || containerId) {
    return {
      location: "container",
      containerName,
      containerId,
    };
  }
  return {
    location: "host",
    containerName,
    containerId,
  };
}

function isProcessRunning(pid: number | null): boolean {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJsonResponse(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  timeoutHandle.unref?.();
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`.trim());
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function readInstanceProbePayload(
  instance: SharedInstanceRecord,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  endpointPath: string,
  runContainerProbe?: BuildSharedInstanceRecordOptions["runContainerProbe"],
): Promise<unknown> {
  const baseUrl = `http://127.0.0.1:${instance.port}`;
  if (instance.runtime.location === "container" && runContainerProbe) {
    return await runContainerProbe(instance, {
      path: endpointPath,
      timeoutMs,
    });
  }
  return await readJsonResponse(fetchImpl, `${baseUrl}${endpointPath}`, timeoutMs);
}

async function probeSharedInstanceDiagnostics(
  instance: SharedInstanceRecord,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  runContainerProbe?: BuildSharedInstanceRecordOptions["runContainerProbe"],
): Promise<SharedInstanceProbe> {
  const checkedAt = new Date().toISOString();
  if (instance.process.state !== "running" || !instance.port) {
    return {
      checkedAt,
      live: null,
      ready: null,
      version: null,
      usageSummary: null,
      error: "instance not running",
    };
  }

  const results = await Promise.allSettled([
    readInstanceProbePayload(instance, fetchImpl, timeoutMs, "/healthz", runContainerProbe),
    readInstanceProbePayload(instance, fetchImpl, timeoutMs, "/readyz", runContainerProbe),
    readInstanceProbePayload(instance, fetchImpl, timeoutMs, "/version", runContainerProbe),
  ]);

  const livePayload =
    results[0].status === "fulfilled" && isObject(results[0].value) ? results[0].value : null;
  const readyPayload =
    results[1].status === "fulfilled" && isObject(results[1].value) ? results[1].value : null;
  const versionPayload =
    results[2].status === "fulfilled" && isObject(results[2].value) ? results[2].value : null;

  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)))
    .filter(Boolean);

  return {
    checkedAt,
    live: livePayload?.["ok"] === true,
    ready: typeof readyPayload?.["ready"] === "boolean" ? (readyPayload["ready"] as boolean) : null,
    version:
      typeof versionPayload?.["version"] === "string" ? (versionPayload["version"] as string) : null,
    usageSummary: null,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  };
}

async function probeSharedInstanceUsageSummary(
  instance: SharedInstanceRecord,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  runContainerProbe?: BuildSharedInstanceRecordOptions["runContainerProbe"],
): Promise<SharedInstanceUsageSummaryResult> {
  const checkedAt = new Date().toISOString();
  if (instance.process.state !== "running" || !instance.port) {
    return {
      checkedAt,
      usageSummary: null,
      error: "instance not running",
    };
  }

  try {
    const payload = await readInstanceProbePayload(
      instance,
      fetchImpl,
      timeoutMs,
      "/shared/usage/summary",
      runContainerProbe,
    );
    return {
      checkedAt,
      usageSummary: isObject(payload) ? (payload as SharedUsageSummaryPayload) : null,
    };
  } catch (error) {
    return {
      checkedAt,
      usageSummary: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getDiagnosticsCacheKey(instance: SharedInstanceRecord): string {
  return `${instance.paths.dir}::diagnostics`;
}

function getUsageSummaryCacheKey(instance: SharedInstanceRecord): string {
  return `${instance.paths.dir}::usage-summary`;
}

function mergeUsageSummaryCounts(
  target: Record<string, number>,
  source: unknown,
): void {
  if (!isObject(source)) {
    return;
  }
  for (const [key, value] of Object.entries(source)) {
    target[key] = Number(target[key] ?? 0) + Number(value ?? 0);
  }
}

function buildUsageSummaryAggregatePayload(
  results: SharedInstanceUsageSummaryResult[],
): SharedUsageSummaryPayload | null {
  const countsByOutcome: Record<string, number> = {};
  const countsByToolName: Record<string, number> = {};
  const countsByToolNameAction: Record<string, number> = {};
  const countsByRouteType: Record<string, number> = {};
  const countsByRuleId: Record<string, number> = {};
  const countsByDeniedReason: Record<string, number> = {};

  let totalCount = 0;
  let hasUsageSummary = false;

  for (const result of results) {
    const summary = result.usageSummary;
    if (!isObject(summary)) {
      continue;
    }
    hasUsageSummary = true;
    totalCount += Number(summary.totalCount ?? 0);
    mergeUsageSummaryCounts(countsByOutcome, summary.countsByOutcome);
    mergeUsageSummaryCounts(countsByToolName, summary.countsByToolName);
    mergeUsageSummaryCounts(countsByToolNameAction, summary.countsByToolNameAction);
    mergeUsageSummaryCounts(countsByRouteType, summary.countsByRouteType);
    mergeUsageSummaryCounts(countsByRuleId, summary.countsByRuleId);
    mergeUsageSummaryCounts(countsByDeniedReason, summary.countsByDeniedReason);
  }

  if (!hasUsageSummary) {
    return null;
  }

  return {
    totalCount,
    countsByOutcome,
    countsByToolName,
    countsByToolNameAction,
    countsByRouteType,
    countsByRuleId,
    countsByDeniedReason,
  };
}

export async function readSharedInstanceUsageSummary(
  instance: SharedInstanceRecord,
  options: BuildSharedInstanceUsageSummaryOptions = {},
): Promise<SharedInstanceUsageSummaryResult> {
  const cacheTtlMs =
    options.cacheTtlMs == null ? DEFAULT_DIAGNOSTICS_CACHE_TTL_MS : Math.max(0, options.cacheTtlMs);
  const cacheKey = getUsageSummaryCacheKey(instance);
  const now = Date.now();
  const cached = usageSummaryCache.get(cacheKey);
  if (cacheTtlMs > 0 && cached && cached.expiresAt > now) {
    return cached.result;
  }

  const result = await probeSharedInstanceUsageSummary(
    instance,
    options.fetchImpl ?? fetch,
    options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    options.runContainerProbe,
  );

  if (cacheTtlMs > 0) {
    usageSummaryCache.set(cacheKey, {
      result,
      expiresAt: now + cacheTtlMs,
    });
  } else {
    usageSummaryCache.delete(cacheKey);
  }

  return result;
}

export async function readSharedInstancesUsageSummaryAggregate(
  instances: SharedInstanceRecord[],
  options: BuildSharedInstanceUsageSummaryOptions = {},
): Promise<SharedInstancesUsageSummaryAggregateResult> {
  const results = await Promise.all(instances.map((item) => readSharedInstanceUsageSummary(item, options)));
  return {
    checkedAt: new Date().toISOString(),
    usageSummary: buildUsageSummaryAggregatePayload(results),
    instanceCount: instances.length,
    reportedInstanceCount: results.filter((result) => isObject(result.usageSummary)).length,
  };
}

export async function readSharedInstanceDiagnostics(
  instance: SharedInstanceRecord,
  options: BuildSharedInstanceDiagnosticsOptions = {},
): Promise<SharedInstanceProbe> {
  const cacheTtlMs =
    options.cacheTtlMs == null ? DEFAULT_DIAGNOSTICS_CACHE_TTL_MS : Math.max(0, options.cacheTtlMs);
  const cacheKey = getDiagnosticsCacheKey(instance);
  const now = Date.now();
  const cached = diagnosticsCache.get(cacheKey);
  if (cacheTtlMs > 0 && cached && cached.expiresAt > now) {
    return cached.probe;
  }

  const probe = await probeSharedInstanceDiagnostics(
    instance,
    options.fetchImpl ?? fetch,
    options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    options.runContainerProbe,
  );
  const usage = await readSharedInstanceUsageSummary(instance, options);
  const result: SharedInstanceProbe = {
    ...probe,
    usageSummary: usage.usageSummary,
    ...(!probe.error && usage.error ? { error: usage.error } : {}),
  };

  if (cacheTtlMs > 0) {
    diagnosticsCache.set(cacheKey, {
      probe: result,
      expiresAt: now + cacheTtlMs,
    });
  } else {
    diagnosticsCache.delete(cacheKey);
  }

  return result;
}

async function readInstanceEnvFile(filePath: string): Promise<InstanceEnvRecord> {
  return parseInstanceEnv(await fs.readFile(filePath, "utf8"));
}

export function resolveSharedConsoleRepoRoot(moduleUrl = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "../../..");
}

export function resolveSharedConsoleInstancesRoot(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = resolveSharedConsoleRepoRoot(),
): string {
  return path.resolve(
    env.SHARED_CONSOLE_API_INSTANCES_ROOT?.trim() ||
      env.OPENCLAW_SHARED_INSTANCES_ROOT?.trim() ||
      path.join(repoRoot, ".shared-instances"),
  );
}

export function resolveSharedConsoleDedicatedInstancesRoot(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = resolveSharedConsoleRepoRoot(),
): string {
  return path.resolve(
    env.SHARED_CONSOLE_API_DEDICATED_INSTANCES_ROOT?.trim() ||
      env.OPENCLAW_DEDICATED_INSTANCES_ROOT?.trim() ||
      path.join(repoRoot, ".dedicated-instances"),
  );
}

export function resolveSharedConsoleApiBashPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SHARED_CONSOLE_API_BASH?.trim() || env.BASH?.trim();
  if (configured) {
    return configured;
  }
  if (process.platform === "win32") {
    return GIT_BASH_WINDOWS_PATH;
  }
  return "bash";
}

export function validateSharedInstanceId(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

export async function listSharedInstanceIds(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && validateSharedInstanceId(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function buildSharedInstanceRecord(
  instanceDir: string,
  options: BuildSharedInstanceRecordOptions = {},
): Promise<SharedInstanceRecord> {
  const envFile = path.join(instanceDir, "instance.env");
  const envRecord = await readInstanceEnvFile(envFile);
  const stats = await fs.stat(instanceDir);
  const pidFile = normalizeNullableString(envRecord.INSTANCE_PID_FILE);
  const pidRaw = pidFile
    ? await fs.readFile(pidFile, "utf8").then((value) => value.trim()).catch(() => "")
    : "";
  const pid = readPidValue(pidRaw);
  const runtime = resolveInstanceRuntime(envRecord);
  const processState: SharedInstanceProcessState =
    runtime.location === "container" ? (pid ? "running" : "stopped") : isProcessRunning(pid) ? "running" : "stopped";

  const record: SharedInstanceRecord = {
    id: normalizeNullableString(envRecord.INSTANCE_ID) ?? path.basename(instanceDir),
    name: normalizeNullableString(envRecord.INSTANCE_NAME) ?? path.basename(instanceDir),
    modelChannelId: normalizeNullableString(envRecord.INSTANCE_MODEL_CHANNEL_ID),
    bind: normalizeNullableString(envRecord.INSTANCE_BIND),
    port: normalizeNullableNumber(envRecord.INSTANCE_PORT),
    profile: normalizeNullableString(envRecord.INSTANCE_PROFILE),
    template: normalizeNullableString(envRecord.INSTANCE_TEMPLATE),
    runtime,
    paths: {
      root: path.dirname(instanceDir),
      dir: instanceDir,
      configPath: normalizeNullableString(envRecord.INSTANCE_CONFIG_PATH ?? envRecord.OPENCLAW_CONFIG_PATH),
      stateDir: normalizeNullableString(envRecord.INSTANCE_STATE_DIR ?? envRecord.OPENCLAW_STATE_DIR),
      logDir: normalizeNullableString(envRecord.INSTANCE_LOG_DIR),
      runDir: normalizeNullableString(envRecord.INSTANCE_RUN_DIR),
      pidFile,
    },
    process: {
      state: processState,
      pid: processState === "running" ? pid : null,
    },
    timestamps: {
      createdAt: stats.birthtime.toISOString(),
      updatedAt: stats.mtime.toISOString(),
    },
    probe: null,
  };

  if (!options.includeProbe) {
    return record;
  }

  record.probe = await readSharedInstanceDiagnostics(record, options);
  return record;
}

export async function listSharedInstances(
  root: string,
  options: BuildSharedInstanceRecordOptions = {},
): Promise<SharedInstanceRecord[]> {
  const ids = await listSharedInstanceIds(root);
  return await Promise.all(ids.map((id) => buildSharedInstanceRecord(path.join(root, id), options)));
}

export async function getSharedInstanceById(
  root: string,
  id: string,
  options: BuildSharedInstanceRecordOptions = {},
): Promise<SharedInstanceRecord | null> {
  if (!validateSharedInstanceId(id)) {
    return null;
  }
  const instanceDir = path.join(root, id);
  try {
    await fs.access(path.join(instanceDir, "instance.env"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return await buildSharedInstanceRecord(instanceDir, options);
}

function escapeDoubleQuotedEnvValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function updateSharedInstanceEnvValues(
  root: string,
  id: string,
  updates: Record<string, string | null | undefined>,
): Promise<void> {
  if (!validateSharedInstanceId(id)) {
    throw new Error(`Invalid instance id: ${id}`);
  }
  const instanceEnvPath = path.join(root, id, "instance.env");
  const content = await fs.readFile(instanceEnvPath, "utf8");
  let nextContent = content;
  for (const [key, rawValue] of Object.entries(updates)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escapedKey}=.*$`, "m");
    if (rawValue == null || rawValue === "") {
      nextContent = pattern.test(nextContent)
        ? nextContent.replace(new RegExp(`^${escapedKey}=.*(?:\\r?\\n)?`, "m"), "")
        : nextContent;
      continue;
    }
    const nextLine = `${key}="${escapeDoubleQuotedEnvValue(rawValue)}"`;
    nextContent = pattern.test(nextContent)
      ? nextContent.replace(pattern, nextLine)
      : `${nextContent.trimEnd()}\n${nextLine}\n`;
  }
  await fs.writeFile(instanceEnvPath, nextContent, "utf8");
}

export async function updateSharedInstanceName(root: string, id: string, name: string): Promise<void> {
  await updateSharedInstanceEnvValues(root, id, {
    INSTANCE_NAME: name,
  });
}
