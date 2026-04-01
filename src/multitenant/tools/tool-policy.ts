import type { RuntimeScope } from "../scope/runtime-scope.js";

export type ToolPolicyDecision = {
  allow: boolean;
  reason: string;
  ruleId: string;
  resourceClass: string;
  supportLevel: "stable" | "experimental" | "unsupported";
  route: "local" | "worker" | "deny";
};

export type ToolPolicyResolver = (
  scope: RuntimeScope | null,
  toolName: string,
  permissionTags?: string[],
) => ToolPolicyDecision | Promise<ToolPolicyDecision>;

export function defaultToolPolicyDecision(): ToolPolicyDecision {
  return {
    allow: true,
    reason: "default local execution policy",
    ruleId: "default.local.v1",
    resourceClass: "generic",
    supportLevel: "stable",
    route: "local",
  };
}
