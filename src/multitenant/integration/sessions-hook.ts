import type { RuntimeScope } from "../scope/runtime-scope.js";
import { buildScopedSessionStoreKey } from "../session/session-key.js";
import {
  resolveScopedSessionStorePath,
  resolveScopedTranscriptPath,
} from "../session/session-paths.js";

export function resolveSessionStorePathForScope(scope?: RuntimeScope): string | undefined {
  return scope?.mode === "shared" ? resolveScopedSessionStorePath(scope) : undefined;
}

export function resolveTranscriptPathForScope(
  scope: RuntimeScope | undefined,
  sessionId: string,
  topicId?: string | number,
): string | undefined {
  return scope?.mode === "shared" ? resolveScopedTranscriptPath(scope, sessionId, topicId) : undefined;
}

export function resolveStoreKeyForScope(
  scope: RuntimeScope | undefined,
  rawSessionKey?: string | null,
): string | undefined {
  return scope?.mode === "shared" ? buildScopedSessionStoreKey(scope, rawSessionKey) : undefined;
}
