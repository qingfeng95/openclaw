import type { RuntimeScope } from "../scope/runtime-scope.js";
import type { MultitenantToolContext } from "../tools/tool-context.js";
import { resolveSharedDefaultToolPolicy } from "../tools/shared-default-policy.js";
import { defaultToolPolicyDecision, type ToolPolicyResolver } from "../tools/tool-policy.js";

export function createMultitenantToolContext(params: {
  runtimeScope?: RuntimeScope;
  toolPolicyResolver?: ToolPolicyResolver;
}): MultitenantToolContext {
  return {
    runtimeScope: params.runtimeScope,
    toolPolicyResolver: params.toolPolicyResolver,
  };
}

export async function resolveToolExecutionPolicy(params: {
  runtimeScope?: RuntimeScope;
  toolName: string;
  permissionTags?: string[];
  args?: Record<string, unknown>;
  toolPolicyResolver?: ToolPolicyResolver;
}) {
  const resolver = params.toolPolicyResolver;
  if (resolver) {
    return await resolver(params.runtimeScope ?? null, params.toolName, params.permissionTags);
  }
  if (params.runtimeScope?.mode === "shared") {
    return resolveSharedDefaultToolPolicy({
      toolName: params.toolName,
      args: params.args,
    });
  }
  return defaultToolPolicyDecision();
}
