import os from "node:os";
import path from "node:path";
import type { RuntimeScope } from "../scope/runtime-scope.js";
import { resolveStateDir } from "../../config/paths.js";

function resolveInstanceRoot(scope: RuntimeScope): string {
  const stateDir = resolveStateDir(process.env, os.homedir);
  return path.join(
    stateDir,
    "tenants",
    scope.tenantId,
    "users",
    scope.userId,
    "instances",
    scope.logicalInstanceId,
  );
}

export function resolveScopedWorkspaceRoot(scope: RuntimeScope): string {
  return path.join(resolveInstanceRoot(scope), "workspace");
}

export function resolveScopedDataRoot(scope: RuntimeScope): string {
  return path.join(resolveInstanceRoot(scope), "data");
}

export function resolveScopedUserPath(scope: RuntimeScope, relativePath: string): string {
  return path.join(resolveScopedDataRoot(scope), relativePath);
}
