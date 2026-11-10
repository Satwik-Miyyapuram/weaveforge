/**
 * Typed reads of frontmatter fields for workspace files. The parser, writer and field
 * reads are Rust (`read_frontmatter` / `write_frontmatter` / `frontmatter_string` /
 * `frontmatter_list`), reached through `rust()`.
 */

import { rust } from "../shared/rust.js";

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
  return rust().frontmatterString(frontmatter, key);
}

export function frontmatterList(
  frontmatter: Record<string, FrontmatterValue>,
  key: string,
): string[] {
  return rust().frontmatterList(frontmatter, key);
}
