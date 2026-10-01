import {
  extractHashtags,
  TAG_SOURCES,
  type ManageTagsUseCase,
  type Paper,
} from "@weaveforge/core";
import { isNetworkFailure } from "@/lib/format-error";

/**
 * Tags live in the note markdown as `#hashtags`. These helpers keep that the
 * single source of truth: converting external (Zotero) tag names into
 * hashtags, appending them to a body, and removing one.
 */

/** Slugify an arbitrary tag name into a single `#hashtag` token (or "" if empty). */
function tagToHashtag(name: string): string {
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

/**
 * {@link reconcileTagsFromBody}, but a note that saved locally is not undone
 * by a tag index the network cannot reach.
 *
 * On the web the paper↔tag links (`paper_tags`) live only on the server (the
 * desktop keeps them locally). With no connection the body is saved, so links are
 * left for later: the paper is remembered and reconciled from its (then
 * current) body when the browser comes back online. Returns `null` when it
 * deferred, so the caller keeps the paper it already has.
 */
export async function reconcileTagsFromBodyOrDefer(
  papers: TagReconcileDeps,
  paperId: string,
  body: string,
): Promise<Paper | null> {
  try {
    const paper = await reconcileTagsFromBody(papers.manageTags, paperId, body);
    void retryDeferredTagReconciles(papers);
    return paper;
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    deferTagReconcile(papers, paperId);
    return null;
  }
}

type TagReconcileDeps = {
  manageTags: ManageTagsUseCase;
  getPaper(id: string): Promise<Paper | null>;
};

const DEFERRED_KEY = "wf.tags.deferredReconcile";

function readDeferred(): string[] {
  try {
    const raw = window.localStorage.getItem(DEFERRED_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeDeferred(ids: readonly string[]): void {
  try {
    if (ids.length) window.localStorage.setItem(DEFERRED_KEY, JSON.stringify(ids));
    else window.localStorage.removeItem(DEFERRED_KEY);
  } catch {
    // Storage blocked: the links catch up on the next save of that note.
  }
}

let listening = false;

function deferTagReconcile(papers: TagReconcileDeps, paperId: string): void {
  writeDeferred([...new Set([...readDeferred(), paperId])]);
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("online", () => void retryDeferredTagReconciles(papers));
}

let retrying: Promise<void> | null = null;

/** Reconcile every paper whose tag links were left for later, from its current body. */
export function retryDeferredTagReconciles(papers: TagReconcileDeps): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  // Cleared after the assignment, not in the body: with nothing queued the
  // body finishes before `??=` stores it, and would leave it set for good.
  retrying ??= (async () => {
    try {
      for (const id of readDeferred()) {
        const paper = await papers.getPaper(id);
        if (paper) await reconcileTagsFromBody(papers.manageTags, id, paper.summary ?? "");
        writeDeferred(readDeferred().filter((x) => x !== id));
      }
    } catch {
      // Still offline, or the server refused: the rest stay queued.
    }
  })().finally(() => {
    retrying = null;
  });
  return retrying;
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
