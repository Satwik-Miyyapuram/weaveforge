/**
 * Shapes of frontmatter for workspace files. The parser, writer and field reads are
 * Rust, reached through `rust()` at the call sites.
 */

export type FrontmatterValue = string | number | boolean | string[];

export interface ParsedDocument {
  frontmatter: Record<string, FrontmatterValue>;
  body: string;
}
