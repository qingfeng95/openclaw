import type { RuntimeScope } from "../scope/runtime-scope.js";
import { buildScopedMemoryManagerKey } from "../memory/memory-manager-key.js";
import { resolveScopedMemorySqlitePath } from "../memory/memory-paths.js";

export function resolveMemoryManagerKeyForScope(
  scope: RuntimeScope | undefined,
  backendKey: string,
): string | undefined {
  return scope?.mode === "shared" ? buildScopedMemoryManagerKey(scope, backendKey) : undefined;
}

export function resolveMemoryStorePathForScope(scope?: RuntimeScope): string | undefined {
  return scope?.mode === "shared" ? resolveScopedMemorySqlitePath(scope) : undefined;
}
