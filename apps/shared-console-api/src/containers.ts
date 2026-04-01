import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SharedInstanceRecord } from "./instances.ts";

const execFileAsync = promisify(execFile);
const RELEVANT_CONTAINER_PATTERN = /(openclaw|crewclaw)/i;
const SAFE_CONTAINER_SELECTOR = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const DEFAULT_LOG_TAIL = 160;
const MAX_LOG_TAIL = 1000;

export type DockerContainerRecord = {
  id: string;
  name: string;
  image: string | null;
  state: string | null;
  status: string | null;
  createdAt: string | null;
  ports: string[];
  labels: Record<string, string>;
};

export type SharedConsoleContainerRecord = DockerContainerRecord & {
  source: "docker" | "declared_only";
  attachedInstances: Array<{
    id: string;
    name: string;
  }>;
};

export type SharedConsoleContainersSnapshot = {
  items: SharedConsoleContainerRecord[];
  meta: {
    available: boolean;
    error: string | null;
    totalDockerContainers: number;
    relevantContainerCount: number;
    linkedContainerCount: number;
    hostInstanceCount: number;
    containerInstanceCount: number;
    hiddenDockerContainerCount: number;
  };
};

export type DockerCommandInvocation = {
  args: string[];
};

export type DockerCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type ListSharedConsoleContainersOptions = {
  listDockerContainers?: () => Promise<DockerContainerRecord[]>;
  includeAllDockerContainers?: boolean;
};

export type RunDockerCommandOptions = {
  runDockerCommand?: (invocation: DockerCommandInvocation) => Promise<DockerCommandResult>;
};

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeContainerKey(value: string | null | undefined): string | null {
  return normalizeOptionalString(value)?.toLowerCase() ?? null;
}

function splitPorts(value: string | null | undefined): string[] {
  const trimmed = value?.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseLabels(value: string | null | undefined): Record<string, string> {
  const trimmed = value?.trim();
  if (!trimmed) {
    return {};
  }
  const labels: Record<string, string> = {};
  for (const part of trimmed.split(",")) {
    const candidate = part.trim();
    if (!candidate) {
      continue;
    }
    const separatorIndex = candidate.indexOf("=");
    if (separatorIndex <= 0) {
      labels[candidate] = "";
      continue;
    }
    const key = candidate.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }
    labels[key] = candidate.slice(separatorIndex + 1).trim();
  }
  return labels;
}

function parseDockerContainerRow(line: string): DockerContainerRecord {
  const parsed = JSON.parse(line) as Record<string, unknown>;
  const id = normalizeOptionalString(typeof parsed.ID === "string" ? parsed.ID : null);
  const name = normalizeOptionalString(typeof parsed.Names === "string" ? parsed.Names : null);
  if (!id || !name) {
    throw new Error(`Invalid docker ps row: ${line}`);
  }
  return {
    id,
    name,
    image: normalizeOptionalString(typeof parsed.Image === "string" ? parsed.Image : null),
    state: normalizeOptionalString(typeof parsed.State === "string" ? parsed.State : null),
    status: normalizeOptionalString(typeof parsed.Status === "string" ? parsed.Status : null),
    createdAt: normalizeOptionalString(typeof parsed.CreatedAt === "string" ? parsed.CreatedAt : null),
    ports: splitPorts(typeof parsed.Ports === "string" ? parsed.Ports : null),
    labels: parseLabels(typeof parsed.Labels === "string" ? parsed.Labels : null),
  };
}

async function listDockerContainersDefault(): Promise<DockerContainerRecord[]> {
  const { stdout } = await execFileAsync("docker", ["ps", "-a", "--no-trunc", "--format", "{{json .}}"], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseDockerContainerRow(line));
}

export async function runDockerCommandDefault(
  invocation: DockerCommandInvocation,
): Promise<DockerCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync("docker", invocation.args, {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    return {
      exitCode: 0,
      stdout,
      stderr,
    };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: String(failure.stdout ?? ""),
      stderr: String(failure.stderr ?? failure.message ?? error),
    };
  }
}

function isRelevantContainer(
  container: DockerContainerRecord,
  linkedNames: Set<string>,
  linkedIds: Set<string>,
): boolean {
  if (linkedNames.has(container.name.toLowerCase()) || linkedIds.has(container.id.toLowerCase())) {
    return true;
  }
  if (RELEVANT_CONTAINER_PATTERN.test(container.name)) {
    return true;
  }
  if (container.image && RELEVANT_CONTAINER_PATTERN.test(container.image)) {
    return true;
  }
  return Object.entries(container.labels).some(
    ([key, value]) => RELEVANT_CONTAINER_PATTERN.test(key) || RELEVANT_CONTAINER_PATTERN.test(value),
  );
}

function buildAttachedInstances(
  instances: SharedInstanceRecord[],
  matcher: (instance: SharedInstanceRecord) => boolean,
): Array<{ id: string; name: string }> {
  return instances
    .filter(matcher)
    .map((instance) => ({
      id: instance.id,
      name: instance.name,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildSyntheticMissingContainers(
  instances: SharedInstanceRecord[],
  matchedNames: Set<string>,
  matchedIds: Set<string>,
): SharedConsoleContainerRecord[] {
  const grouped = new Map<string, SharedConsoleContainerRecord>();
  for (const instance of instances) {
    if (instance.runtime.location !== "container") {
      continue;
    }
    const containerName = normalizeOptionalString(instance.runtime.containerName);
    const containerId = normalizeOptionalString(instance.runtime.containerId);
    const nameKey = normalizeContainerKey(containerName);
    const idKey = normalizeContainerKey(containerId);
    if ((nameKey && matchedNames.has(nameKey)) || (idKey && matchedIds.has(idKey))) {
      continue;
    }

    const syntheticId = containerId ?? `declared:${containerName ?? instance.id}`;
    const syntheticName = containerName ?? containerId ?? `unnamed-${instance.id}`;
    const groupKey = `${syntheticName}::${syntheticId}`;
    const existing = grouped.get(groupKey);
    if (existing) {
      existing.attachedInstances.push({
        id: instance.id,
        name: instance.name,
      });
      continue;
    }
    grouped.set(groupKey, {
      id: syntheticId,
      name: syntheticName,
      image: null,
      state: "missing",
      status: "实例声明了这个容器，但当前 Docker 没有返回它。",
      createdAt: null,
      ports: [],
      labels: {},
      source: "declared_only",
      attachedInstances: [
        {
          id: instance.id,
          name: instance.name,
        },
      ],
    });
  }
  return [...grouped.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function sortContainers(left: SharedConsoleContainerRecord, right: SharedConsoleContainerRecord): number {
  const attachedDiff = right.attachedInstances.length - left.attachedInstances.length;
  if (attachedDiff !== 0) {
    return attachedDiff;
  }
  const stateRank = (value: string | null): number => {
    if (value === "running") {
      return 0;
    }
    if (value === "created") {
      return 1;
    }
    if (value === "exited") {
      return 2;
    }
    if (value === "missing") {
      return 3;
    }
    return 4;
  };
  const stateDiff = stateRank(left.state) - stateRank(right.state);
  if (stateDiff !== 0) {
    return stateDiff;
  }
  return left.name.localeCompare(right.name);
}

function isSafeContainerSelector(value: string): boolean {
  return SAFE_CONTAINER_SELECTOR.test(value);
}

function normalizeLogTail(value: number | undefined): number {
  if (!Number.isFinite(value) || value == null) {
    return DEFAULT_LOG_TAIL;
  }
  return Math.max(1, Math.min(Math.trunc(value), MAX_LOG_TAIL));
}

export async function listSharedConsoleContainers(
  instances: SharedInstanceRecord[],
  options: ListSharedConsoleContainersOptions = {},
): Promise<SharedConsoleContainersSnapshot> {
  const linkedNames = new Set(
    instances
      .map((instance) => normalizeContainerKey(instance.runtime.containerName))
      .filter((value): value is string => Boolean(value)),
  );
  const linkedIds = new Set(
    instances
      .map((instance) => normalizeContainerKey(instance.runtime.containerId))
      .filter((value): value is string => Boolean(value)),
  );

  const hostInstanceCount = instances.filter((instance) => instance.runtime.location === "host").length;
  const containerInstanceCount = instances.filter(
    (instance) => instance.runtime.location === "container",
  ).length;

  let dockerContainers: DockerContainerRecord[] = [];
  let dockerError: string | null = null;
  try {
    dockerContainers = await (options.listDockerContainers ?? listDockerContainersDefault)();
  } catch (error) {
    dockerError = error instanceof Error ? error.message : String(error);
  }

  const matchedNames = new Set<string>();
  const matchedIds = new Set<string>();
  const filteredDockerContainers = (options.includeAllDockerContainers ? dockerContainers : dockerContainers.filter(
    (container) => isRelevantContainer(container, linkedNames, linkedIds),
  ))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  const relevantDockerContainers = filteredDockerContainers
    .map((container) => {
      matchedNames.add(container.name.toLowerCase());
      matchedIds.add(container.id.toLowerCase());
      return {
        ...container,
        source: "docker" as const,
        attachedInstances: buildAttachedInstances(
          instances,
          (instance) =>
            normalizeContainerKey(instance.runtime.containerName) === container.name.toLowerCase() ||
            normalizeContainerKey(instance.runtime.containerId) === container.id.toLowerCase(),
        ),
      };
    });

  const syntheticContainers = buildSyntheticMissingContainers(instances, matchedNames, matchedIds);
  const items = [...relevantDockerContainers, ...syntheticContainers].sort(sortContainers);

  return {
    items,
    meta: {
      available: dockerError == null,
      error: dockerError,
      totalDockerContainers: dockerContainers.length,
      relevantContainerCount: items.length,
      linkedContainerCount: items.filter((item) => item.attachedInstances.length > 0).length,
      hostInstanceCount,
      containerInstanceCount,
      hiddenDockerContainerCount: Math.max(dockerContainers.length - filteredDockerContainers.length, 0),
    },
  };
}

export async function getSharedConsoleContainerBySelector(
  selector: string,
  instances: SharedInstanceRecord[],
  options: ListSharedConsoleContainersOptions = {},
): Promise<SharedConsoleContainerRecord | null> {
  if (!isSafeContainerSelector(selector)) {
    return null;
  }
  const snapshot = await listSharedConsoleContainers(instances, options);
  const normalized = selector.trim().toLowerCase();
  return (
    snapshot.items.find(
      (item) => item.name.toLowerCase() === normalized || item.id.toLowerCase() === normalized,
    ) ?? null
  );
}

export async function runSharedConsoleContainerAction(
  selector: string,
  action: "start" | "stop" | "restart",
  instances: SharedInstanceRecord[],
  options: ListSharedConsoleContainersOptions & RunDockerCommandOptions = {},
): Promise<{
  container: SharedConsoleContainerRecord;
  command: DockerCommandResult;
}> {
  const container = await getSharedConsoleContainerBySelector(selector, instances, options);
  if (!container) {
    throw new Error(`Container not found: ${selector}`);
  }
  if (container.source !== "docker") {
    throw new Error(`Container ${container.name} is declared by instances only and is not operable yet.`);
  }
  const runDockerCommand = options.runDockerCommand ?? runDockerCommandDefault;
  const command = await runDockerCommand({
    args: [action, container.name],
  });
  if (command.exitCode !== 0) {
    throw new Error(command.stderr.trim() || command.stdout.trim() || `docker ${action} failed`);
  }
  return {
    container,
    command,
  };
}

export async function readSharedConsoleContainerLogs(
  selector: string,
  instances: SharedInstanceRecord[],
  options: ListSharedConsoleContainersOptions &
    RunDockerCommandOptions & {
      tail?: number;
    } = {},
): Promise<{
  container: SharedConsoleContainerRecord;
  tail: number;
  text: string;
}> {
  const container = await getSharedConsoleContainerBySelector(selector, instances, options);
  if (!container) {
    throw new Error(`Container not found: ${selector}`);
  }
  if (container.source !== "docker") {
    throw new Error(`Container ${container.name} is declared by instances only and has no Docker logs yet.`);
  }
  const tail = normalizeLogTail(options.tail);
  const runDockerCommand = options.runDockerCommand ?? runDockerCommandDefault;
  const command = await runDockerCommand({
    args: ["logs", "--tail", String(tail), container.name],
  });
  if (command.exitCode !== 0) {
    throw new Error(command.stderr.trim() || command.stdout.trim() || "docker logs failed");
  }
  const merged = [command.stdout.trimEnd(), command.stderr.trimEnd()].filter(Boolean).join("\n");
  return {
    container,
    tail,
    text: merged,
  };
}
