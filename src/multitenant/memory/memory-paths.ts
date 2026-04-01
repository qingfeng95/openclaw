import os from "node:os";
import path from "node:path";
import type { RuntimeScope } from "../scope/runtime-scope.js";
import { resolveStateDir } from "../../config/paths.js";

function resolveScopedMemoryRoot(scope: RuntimeScope): string {
  const stateDir = resolveStateDir(process.env, os.homedir);
  return path.join(
    stateDir,
    "tenants",
    scope.tenantId,
    "users",
    scope.userId,
    "instances",
    scope.logicalInstanceId,
    "memory",
  );
}

export function resolveScopedMemorySqlitePath(scope: RuntimeScope): string {
  return path.join(resolveScopedMemoryRoot(scope), "index.sqlite");
}

export function resolveScopedMemoryQmdDir(scope: RuntimeScope): string {
  return path.join(resolveScopedMemoryRoot(scope), "qmd");
}
