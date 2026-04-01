import { loadConfig } from "../../config/io.js";
import type { BrowserConfig } from "../../config/types.browser.js";
import type { RuntimeScope } from "../scope/runtime-scope.js";
import type { WorkerOffloadResult } from "./worker-offload.js";
import type { ToolPolicyDecision } from "./tool-policy.js";

type RoutedTool = {
  name: string;
  execute?: (toolCallId: string, args: Record<string, unknown>) => Promise<unknown> | unknown;
};

export type ToolRoutingResult =
  | {
      mode: "worker";
      executed: true;
      result: unknown;
      workerKind: "browser" | "nodes" | "generic";
    }
  | {
      mode: "unavailable" | "dedicated-required";
      executed: false;
      errorType: "tool_route_unavailable" | "tool_dedicated_required";
      reason: string;
      ruleId?: string;
      workerKind: "browser" | "nodes" | "generic";
    };

export async function routeToolExecution(params: {
  runtimeScope?: RuntimeScope;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolCallId: string;
  policyDecision: ToolPolicyDecision;
  tool: RoutedTool;
}): Promise<ToolRoutingResult> {
  const normalizedToolName = normalizeToolName(params.toolName);

  if (normalizedToolName === "browser") {
    return await routeBrowserTool(params);
  }
  if (normalizedToolName === "nodes") {
    return await routeNodesTool(params);
  }

  return unavailableResult({
    workerKind: "generic",
    reason: `worker route is not available for tool: ${normalizedToolName}`,
    ruleId: params.policyDecision.ruleId,
  });
}

export async function routeBrowserTool(params: {
  runtimeScope?: RuntimeScope;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolCallId: string;
  policyDecision: ToolPolicyDecision;
  tool: RoutedTool;
}): Promise<ToolRoutingResult> {
  const action = extractToolAction(params.toolArgs);
  if (!isSharedBrowserActionAllowed(action)) {
    return unavailableResult({
      workerKind: "browser",
      reason: action
        ? `shared browser route does not allow action: ${action}`
        : "shared browser route requires a supported action",
      ruleId: params.policyDecision.ruleId,
    });
  }

  if (!isSharedBrowserRoutedExecutionEnabledFromRuntime()) {
    return unavailableResult({
      workerKind: "browser",
      reason: "shared browser route is disabled by config",
      ruleId: params.policyDecision.ruleId,
    });
  }

  if (params.runtimeScope?.mode !== "shared") {
    return dedicatedRequiredResult({
      workerKind: "browser",
      reason: "browser worker routing is only defined for shared runtime scope",
      ruleId: params.policyDecision.ruleId,
    });
  }

  if (typeof params.tool.execute !== "function") {
    return unavailableResult({
      workerKind: "browser",
      reason: `shared browser route recognized action ${action} but tool execution is unavailable`,
      ruleId: params.policyDecision.ruleId,
    });
  }

  const result = await params.tool.execute(params.toolCallId, params.toolArgs);
  return {
    mode: "worker",
    executed: true,
    result,
    workerKind: "browser",
  };
}

export async function routeNodesTool(params: {
  runtimeScope?: RuntimeScope;
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolCallId: string;
  policyDecision: ToolPolicyDecision;
  tool: RoutedTool;
}): Promise<ToolRoutingResult> {
  const action = extractToolAction(params.toolArgs);
  return unavailableResult({
    workerKind: "nodes",
    reason: action
      ? `共享模式暂不支持 nodes 能力，请改用独立实例 (action: ${action})`
      : "共享模式暂不支持 nodes 能力，请改用独立实例",
    ruleId: params.policyDecision.ruleId,
  });
}

// Shared 2026-03-28 formal baseline:
// - browser allowlist is intentionally limited to the lowest-risk read actions
// - nodes do not enter Shared at all in the current baseline
// Any future nodes recovery must go through an explicitly designed narrow Shared-ready surface.
const SHARED_BROWSER_ALLOWED_ACTIONS = new Set(["status", "profiles", "tabs"]);

export function isSharedBrowserActionAllowed(action: string | undefined): boolean {
  if (!action) {
    return false;
  }
  return SHARED_BROWSER_ALLOWED_ACTIONS.has(action.trim().toLowerCase());
}

export function isSharedNodesActionAllowed(_action: string | undefined): boolean {
  return false;
}

export function isSharedBrowserRoutedExecutionEnabled(config?: { browser?: BrowserConfig }): boolean {
  return config?.browser?.sharedRoutedExecutionEnabled === true;
}

function extractToolAction(args: Record<string, unknown>): string | undefined {
  const value = args.action;
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
}

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

function unavailableResult(params: {
  workerKind: "browser" | "nodes" | "generic";
  reason: string;
  ruleId?: string;
}): Extract<ToolRoutingResult, { mode: "unavailable" }> {
  return {
    mode: "unavailable",
    executed: false,
    errorType: "tool_route_unavailable",
    reason: params.reason,
    ruleId: params.ruleId,
    workerKind: params.workerKind,
  };
}

function dedicatedRequiredResult(params: {
  workerKind: "browser" | "nodes" | "generic";
  reason: string;
  ruleId?: string;
}): Extract<ToolRoutingResult, { mode: "dedicated-required" }> {
  return {
    mode: "dedicated-required",
    executed: false,
    errorType: "tool_dedicated_required",
    reason: params.reason,
    ruleId: params.ruleId,
    workerKind: params.workerKind,
  };
}

export function workerOffloadResultToToolRoutingResult(
  result: WorkerOffloadResult,
): ToolRoutingResult {
  if (result.ok) {
    return {
      mode: result.mode,
      executed: result.executed,
      result: result.result,
      workerKind: (result.workerKind as "browser" | "nodes" | "generic" | undefined) ?? "generic",
    };
  }
  return {
    mode: result.mode,
    executed: result.executed,
    errorType: result.errorType,
    reason: result.reason,
    ruleId: result.ruleId,
    workerKind: (result.workerKind as "browser" | "nodes" | "generic" | undefined) ?? "generic",
  };
}

function getSharedBrowserRoutingConfig(): { browser?: BrowserConfig } {
  return loadConfig();
}

function isSharedBrowserRoutedExecutionEnabledFromRuntime(): boolean {
  return isSharedBrowserRoutedExecutionEnabled(getSharedBrowserRoutingConfig());
}
