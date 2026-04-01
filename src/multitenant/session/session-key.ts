import type { RuntimeScope } from "../scope/runtime-scope.js";

export function buildScopedSessionNamespace(scope: RuntimeScope): string {
  return [scope.tenantId, scope.userId, scope.logicalInstanceId].join(":");
}

export function buildScopedSessionStoreKey(
  scope: RuntimeScope,
  rawSessionKey?: string | null,
): string {
  const normalizedRaw = rawSessionKey?.trim().toLowerCase() || scope.sessionId.trim().toLowerCase();
  return `${buildScopedSessionNamespace(scope)}:${normalizedRaw}`;
}
