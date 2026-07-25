import {
  extractHashtags,
  TAG_SOURCES,
  type ManageTagsUseCase,
  type Paper,
} from "@thesis/core";

/**
 * Tags live in the note markdown as `#hashtags`. These helpers keep that the
 * single source of truth: converting external (Zotero) tag names into
 * hashtags, appending them to a body, and removing one.
 */

/** Slugify an arbitrary tag name into a single `#hashtag` token (or "" if empty). */
export function tagToHashtag(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug ? `#${slug}` : "";
}

/** Append any tag names not already present in the body as `#hashtag` lines. */
export function appendTagHashtags(body: string, tagNames: readonly string[]): string {
  const have = new Set(extractHashtags(body));
  const lines: string[] = [];
  for (const name of tagNames) {
    const h = tagToHashtag(name);
    if (!h || have.has(h.slice(1))) continue;
    have.add(h.slice(1));
    lines.push(h);
  }
  if (lines.length === 0) return body;
  const base = body.replace(/\s+$/, "");
  return `${base ? `${base}\n\n` : ""}${lines.join("\n")}\n`;
}

/**
 * Make the note body the single source of truth for a paper's tags: reconcile
 * its tag index (across every source, incl. legacy synced tags) to exactly the
 * body's #hashtags as manual tags.
 */
export function reconcileTagsFromBody(
  manageTags: ManageTagsUseCase,
  paperId: string,
  body: string,
): Promise<Paper> {
  return manageTags.reconcileSources(
    paperId,
    extractHashtags(body).map((name) => ({ name, source: "manual" as const })),
    TAG_SOURCES,
  );
}

/** Remove every `#hashtag` in the body whose normalized name equals `tag`. */
export function removeHashtagFromBody(body: string, tag: string): string {
  const t = tag.trim().toLowerCase();
  return body
    .replace(/#[\p{L}\p{N}_-]+/gu, (m) => (m.slice(1).toLowerCase() === t ? "" : m))
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/, "\n")
    .replace(/^\n+/, "");
}
