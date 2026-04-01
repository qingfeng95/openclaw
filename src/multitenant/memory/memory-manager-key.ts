import type { RuntimeScope } from "../scope/runtime-scope.js";

export function buildScopedMemoryManagerKey(
  scope: RuntimeScope,
  backendKey: string,
): string {
  return [scope.mode, scope.tenantId, scope.userId, scope.logicalInstanceId, backendKey].join(":");
}
