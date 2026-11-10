/**
 * Typed reads of one frontmatter field (Rust `sync::frontmatter::frontmatter_string` and
 * `frontmatter_list`), re-exported from index.ts. Keeps the signatures of
 * apps/core workspace/frontmatter.ts.
 */
import {
  frontmatterList as rawFrontmatterList,
  frontmatterString as rawFrontmatterString,
} from "../pkg/wf_wasm.js";

/** A field as text, whatever scalar it parsed as; undefined when absent, a list, or blank. */
export function frontmatterString(
  frontmatter: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  return rawFrontmatterString(frontmatter, key);
}

/** A list field's entries; a non-blank scalar string is one entry; anything else is empty. */
export function frontmatterList(
  frontmatter: Readonly<Record<string, unknown>>,
  key: string,
): string[] {
  return rawFrontmatterList(frontmatter, key) as string[];
}
