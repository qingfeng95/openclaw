import { resolveWorkspaceRootForScope } from "../multitenant/integration/workspace-hook.js";
import { getCurrentRuntimeScope } from "../multitenant/scope/request-context.js";
import path from "node:path";
import { resolveUserPath } from "../utils.js";

export function normalizeWorkspaceDir(workspaceDir?: string): string | null {
  const trimmed = workspaceDir?.trim();
  if (!trimmed) {
    return null;
  }
  const expanded = trimmed.startsWith("~") ? resolveUserPath(trimmed) : trimmed;
  const resolved = path.resolve(expanded);
  // Refuse filesystem roots as "workspace" (too broad; almost always a bug).
  if (resolved === path.parse(resolved).root) {
    return null;
  }
  return resolved;
}

export function resolveWorkspaceRoot(workspaceDir?: string): string {
  const scope = getCurrentRuntimeScope();
  const scopedRoot = resolveWorkspaceRootForScope(scope ?? undefined);
  if (scopedRoot) {
    return scopedRoot;
  }
  return normalizeWorkspaceDir(workspaceDir) ?? process.cwd();
}
