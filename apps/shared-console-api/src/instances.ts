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

export type SharedInstanceRecord = {
  id: string;
  name: string;
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

type InstanceEnvRecord = Record<string, string>;

const DEFAULT_PROBE_TIMEOUT_MS = 1_500;
const GIT_BASH_WINDOWS_PATH = "C:\\Program Files\\Git\\bin\\bash.exe";

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

async function probeSharedInstance(
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

  const baseUrl = `http://127.0.0.1:${instance.port}`;
  const readProbe = (endpointPath: string) => {
    if (instance.runtime.location === "container" && runContainerProbe) {
      return runContainerProbe(instance, {
        path: endpointPath,
        timeoutMs,
      });
    }
    return readJsonResponse(fetchImpl, `${baseUrl}${endpointPath}`, timeoutMs);
  };
  const results = await Promise.allSettled([
    readProbe("/healthz"),
    readProbe("/readyz"),
    readProbe("/version"),
    readProbe("/shared/usage/summary"),
  ]);

  const livePayload =
    results[0].status === "fulfilled" && isObject(results[0].value) ? results[0].value : null;
  const readyPayload =
    results[1].status === "fulfilled" && isObject(results[1].value) ? results[1].value : null;
  const versionPayload =
    results[2].status === "fulfilled" && isObject(results[2].value) ? results[2].value : null;
  const usagePayload =
    results[3].status === "fulfilled" && isObject(results[3].value) ? results[3].value : null;

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
    usageSummary: usagePayload as SharedUsageSummaryPayload | null,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  };
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

  record.probe = await probeSharedInstance(
    record,
    options.fetchImpl ?? fetch,
    options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    options.runContainerProbe,
  );
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

export async function updateSharedInstanceName(root: string, id: string, name: string): Promise<void> {
  if (!validateSharedInstanceId(id)) {
    throw new Error(`Invalid instance id: ${id}`);
  }
  const instanceEnvPath = path.join(root, id, "instance.env");
  const content = await fs.readFile(instanceEnvPath, "utf8");
  const nextLine = `INSTANCE_NAME="${escapeDoubleQuotedEnvValue(name)}"`;
  const nextContent = /^INSTANCE_NAME=.*$/m.test(content)
    ? content.replace(/^INSTANCE_NAME=.*$/m, nextLine)
    : `${content.trimEnd()}\n${nextLine}\n`;
  await fs.writeFile(instanceEnvPath, nextContent, "utf8");
}
