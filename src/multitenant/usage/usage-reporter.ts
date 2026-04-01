import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import type { RuntimeScope } from "../scope/runtime-scope.js";
import type { SharedToolUsageEvent, SharedToolUsageOutcome, SharedToolUsageRouteType } from "./event-types.js";

const DEFAULT_USAGE_AUDIT_FILENAME = "shared-tool-usage.jsonl";

export function resolveSharedToolUsageLogPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "logs", DEFAULT_USAGE_AUDIT_FILENAME);
}

export function reportSharedToolUsageEvent(event: SharedToolUsageEvent): void {
  const line = JSON.stringify(event);
  if (!line) {
    return;
  }
  const filePath = resolveSharedToolUsageLogPath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${line}\n`, "utf8");
  } catch (error) {
    console.error("[shared-tool-usage] write failed:", error);
  }
}

export function buildSharedToolUsageEvent(params: {
  runtimeScope?: RuntimeScope;
  toolName: string;
  action?: string;
  outcome: SharedToolUsageOutcome;
  routeType: SharedToolUsageRouteType;
  ruleId?: string;
  reason?: string;
  latencyMs?: number;
  workerKind?: SharedToolUsageEvent["workerKind"];
}): SharedToolUsageEvent {
  const { runtimeScope } = params;
  const timestamp = new Date().toISOString();
  const version = process.env.OPENCLAW_SERVICE_VERSION?.trim() || undefined;
  return {
    ts: timestamp,
    timestamp,
    requestId: runtimeScope?.requestId,
    version,
    runtimeMode: runtimeScope?.mode,
    tenantId: runtimeScope?.tenantId,
    userId: runtimeScope?.userId,
    logicalInstanceId: runtimeScope?.logicalInstanceId,
    instanceId: runtimeScope?.logicalInstanceId,
    toolName: params.toolName,
    action: params.action,
    outcome: params.outcome,
    routeType: params.routeType,
    ruleId: params.ruleId,
    reason: params.reason,
    deniedReason: params.reason,
    latencyMs: params.latencyMs,
    workerKind: params.workerKind,
  };
}
