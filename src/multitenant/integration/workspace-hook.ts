import type { RuntimeScope } from "../scope/runtime-scope.js";
import { resolveScopedSafePath } from "../workspace/path-guard.js";
import {
  resolveScopedDataRoot,
  resolveScopedWorkspaceRoot,
} from "../workspace/workspace-resolver.js";

export function resolveWorkspaceRootForScope(scope?: RuntimeScope): string | undefined {
  return scope?.mode === "shared" ? resolveScopedWorkspaceRoot(scope) : undefined;
}

export function resolveScopedDataRootForScope(scope?: RuntimeScope): string | undefined {
  return scope?.mode === "shared" ? resolveScopedDataRoot(scope) : undefined;
}

export function resolveSafeUserPathForScope(
  scope: RuntimeScope | undefined,
  relativePath: string,
  area: "data" | "workspace" = "data",
): string | undefined {
  if (scope?.mode !== "shared") {
    return undefined;
  }
  const root = area === "workspace" ? resolveScopedWorkspaceRoot(scope) : resolveScopedDataRoot(scope);
  return resolveScopedSafePath(root, relativePath);
}
