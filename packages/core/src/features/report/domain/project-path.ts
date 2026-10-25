/**
 * A path inside a report project, written the one way: `/` separators, no `.`
 * parts, `..` folded in. Returns null for a path that climbs out of the project.
 */
export function normalizeProjectPath(path: string): string | null {
  const normalized: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!normalized.length) return null;
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }
  return normalized.join("/");
}
