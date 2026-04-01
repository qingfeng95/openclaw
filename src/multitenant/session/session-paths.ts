import os from "node:os";
import path from "node:path";
import type { RuntimeScope } from "../scope/runtime-scope.js";
import { resolveStateDir } from "../../config/paths.js";

export function resolveScopedSessionsDir(scope: RuntimeScope): string {
  const stateDir = resolveStateDir(process.env, os.homedir);
  return path.join(
    stateDir,
    "tenants",
    scope.tenantId,
    "users",
    scope.userId,
    "instances",
    scope.logicalInstanceId,
    "sessions",
  );
}

export function resolveScopedSessionStorePath(scope: RuntimeScope): string {
  return path.join(resolveScopedSessionsDir(scope), "sessions.json");
}

export function resolveScopedTranscriptPath(
  scope: RuntimeScope,
  sessionId: string,
  topicId?: string | number,
): string {
  const normalizedSessionId = sessionId.trim();
  const suffix =
    topicId !== undefined ? `-topic-${encodeURIComponent(String(topicId))}` : "";
  return path.join(resolveScopedSessionsDir(scope), `${normalizedSessionId}${suffix}.jsonl`);
}
