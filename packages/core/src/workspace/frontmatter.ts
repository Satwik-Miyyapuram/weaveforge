/**
 * Typed reads of frontmatter fields for workspace files. The parser and writer are
 * Rust (`read_frontmatter` / `write_frontmatter`), reached through `rust()`.
 */

export type FrontmatterValue = string | number | boolean | string[];

export interface ParsedDocument {
  frontmatter: Record<string, FrontmatterValue>;
  body: string;
}

/** Read a frontmatter field as a string, whatever scalar type it parsed as. */
export function frontmatterString(
  frontmatter: Record<string, FrontmatterValue>,
  key: string,
): string | undefined {
  const value = frontmatter[key];
  if (value === undefined || Array.isArray(value)) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

export function frontmatterList(
  frontmatter: Record<string, FrontmatterValue>,
  key: string,
): string[] {
  const value = frontmatter[key];
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}
