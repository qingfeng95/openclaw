import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimeScope } from "../scope/runtime-scope.js";
import { resolveScopedSafePath } from "./path-guard.js";
import { resolveScopedDataRoot, resolveScopedWorkspaceRoot } from "./workspace-resolver.js";

export function resolveScopedFsRoot(
  scope: RuntimeScope,
  area: "data" | "workspace" = "data",
): string {
  return area === "workspace" ? resolveScopedWorkspaceRoot(scope) : resolveScopedDataRoot(scope);
}

export function resolveScopedFsPath(
  scope: RuntimeScope,
  relativePath: string,
  area: "data" | "workspace" = "data",
): string {
  return resolveScopedSafePath(resolveScopedFsRoot(scope, area), relativePath);
}

export async function ensureScopedFsRoot(
  scope: RuntimeScope,
  area: "data" | "workspace" = "data",
): Promise<string> {
  const root = resolveScopedFsRoot(scope, area);
  await fs.mkdir(root, { recursive: true });
  return root;
}

export async function readScopedTextFile(
  scope: RuntimeScope,
  relativePath: string,
  area: "data" | "workspace" = "data",
): Promise<string> {
  const target = resolveScopedFsPath(scope, relativePath, area);
  return await fs.readFile(target, "utf-8");
}

export async function writeScopedTextFile(
  scope: RuntimeScope,
  relativePath: string,
  content: string,
  area: "data" | "workspace" = "data",
): Promise<string> {
  const root = await ensureScopedFsRoot(scope, area);
  const target = resolveScopedSafePath(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf-8");
  return target;
}

export async function scopedPathExists(
  scope: RuntimeScope,
  relativePath: string,
  area: "data" | "workspace" = "data",
): Promise<boolean> {
  const target = resolveScopedFsPath(scope, relativePath, area);
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
