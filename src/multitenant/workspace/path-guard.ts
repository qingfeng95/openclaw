import path from "node:path";

export function assertPathWithinRoot(root: string, resolvedPath: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(resolvedPath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Resolved path escapes scoped root.");
  }
}

export function resolveScopedSafePath(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  assertPathWithinRoot(root, resolved);
  return resolved;
}
