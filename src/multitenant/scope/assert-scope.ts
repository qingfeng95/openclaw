import { isRuntimeScope, type RuntimeScope } from "./runtime-scope.js";

export function assertRuntimeScope(scope: unknown): asserts scope is RuntimeScope {
  if (!isRuntimeScope(scope)) {
    throw new Error("Invalid or missing runtime scope.");
  }
}

export function assertSharedRuntimeScope(scope: RuntimeScope): void {
  if (scope.mode !== "shared") {
    throw new Error("Expected shared runtime scope.");
  }
}
