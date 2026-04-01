import { AsyncLocalStorage } from "node:async_hooks";
import type { RuntimeScope } from "./runtime-scope.js";

const runtimeScopeStorage = new AsyncLocalStorage<RuntimeScope>();

export function runWithRuntimeScope<T>(scope: RuntimeScope, fn: () => T): T {
  return runtimeScopeStorage.run(scope, fn);
}

export function runWithOptionalRuntimeScope<T>(scope: RuntimeScope | null | undefined, fn: () => T): T {
  if (!scope) {
    return fn();
  }
  return runWithRuntimeScope(scope, fn);
}

export function getCurrentRuntimeScope(): RuntimeScope | null {
  return runtimeScopeStorage.getStore() ?? null;
}

export function requireCurrentRuntimeScope(): RuntimeScope {
  const scope = getCurrentRuntimeScope();
  if (!scope) {
    throw new Error("Runtime scope is not set for the current request.");
  }
  return scope;
}
