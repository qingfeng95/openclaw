import type { RuntimeScope } from "../scope/runtime-scope.js";
import type { ToolPolicyResolver } from "./tool-policy.js";

export type MultitenantToolContext = {
  runtimeScope?: RuntimeScope;
  toolPolicyResolver?: ToolPolicyResolver;
};
