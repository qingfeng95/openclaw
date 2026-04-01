import type { ToolPolicyDecision } from "./tool-policy.js";

export type WorkerOffloadRequest = {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  policyDecision: ToolPolicyDecision;
};

export type WorkerOffloadResult =
  | {
      ok: true;
      mode: "worker";
      executed: boolean;
      result: unknown;
      workerKind?: string;
    }
  | {
      ok: false;
      mode: "unavailable" | "dedicated-required";
      executed: false;
      errorType: "tool_route_unavailable" | "tool_dedicated_required";
      reason: string;
      ruleId?: string;
      workerKind?: string;
    };

export interface WorkerOffloadClient {
  execute(request: WorkerOffloadRequest): Promise<WorkerOffloadResult>;
}
