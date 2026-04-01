import type { RuntimeScope } from "../scope/runtime-scope.js";

export type SharedToolUsageOutcome =
  | "tool_policy_denied"
  | "tool_routed_executed"
  | "tool_route_unavailable"
  | "tool_dedicated_required"
  | "tool_local_executed";

export type SharedToolUsageRouteType = "local" | "worker" | "deny";

export interface SharedToolUsageEvent {
  ts: string;
  timestamp?: string;
  requestId?: string;
  version?: string;
  runtimeMode?: RuntimeScope["mode"];
  tenantId?: string;
  userId?: string;
  logicalInstanceId?: string;
  instanceId?: string;
  toolName: string;
  action?: string;
  outcome: SharedToolUsageOutcome;
  routeType: SharedToolUsageRouteType;
  ruleId?: string;
  reason?: string;
  deniedReason?: string;
  latencyMs?: number;
  workerKind?: "browser" | "nodes" | "generic";
}
