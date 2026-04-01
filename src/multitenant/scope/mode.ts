import type { RuntimeScope } from "./runtime-scope.js";

export function isSharedMode(scope: Pick<RuntimeScope, "mode"> | null | undefined): boolean {
  return scope?.mode === "shared";
}

export function isDedicatedMode(scope: Pick<RuntimeScope, "mode"> | null | undefined): boolean {
  return scope?.mode === "dedicated";
}
