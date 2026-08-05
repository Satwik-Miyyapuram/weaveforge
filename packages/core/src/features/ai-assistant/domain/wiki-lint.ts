/**
 * Health checks over the wiki.
 *
 * All of these are findable without a model, which matters: lint is the thing
 * you want to run often, and a check that costs an API call per page is a check
 * nobody runs. Duplicate detection is tiered for the same reason — exact and
 * near-exact matches are caught locally, and only genuinely ambiguous pairs are
 * worth escalating to a model.
 */

import { extractWikilinks, normalizeTitleKey } from "../../vault/domain/vault-page.js";
import { conceptKey } from "./ai-extraction.js";

export interface WikiPageRef {
  id: string;
  title: string;
  body: string;
  aliases?: readonly string[];
}

export type LintKind =
  | "duplicate"
  | "near-duplicate"
  | "dead-link"
  | "orphan"
  | "empty";

export type LintSeverity = "error" | "warning" | "info";

export interface LintFinding {
  kind: LintKind;
  severity: LintSeverity;
  pageId: string;
  message: string;
  /** The other page involved, for duplicates. */
  relatedPageId?: string;
  /** The unresolved target, for dead links. */
  target?: string;
}

export interface LintReport {
  findings: LintFinding[];
  counts: Record<LintKind, number>;
}

/** A page with nothing but frontmatter and headings has no content of its own. */
const MIN_CONTENT_CHARS = 40;

function contentLength(body: string): number {
  return body
    .replace(/^---[\s\S]*?---/, "")
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\[\[[^\]]*\]\]/g, "")
    .replace(/_Not written yet\._/g, "")
    .replace(/^>.*$/gm, "")
    .replace(/#[\w-]+/g, "")
    .trim().length;
}

/**
 * Character-level similarity, for near-duplicate titles.
 *
 * Trigram overlap rather than edit distance: it is linear, and it catches the
 * reorderings and expansions that actually occur ("Variational Autoencoder"
 * vs "Autoencoder, Variational") where edit distance would call them far apart.
 */
export function titleSimilarity(a: string, b: string): number {
  const trigrams = (value: string) => {
    const padded = ` ${conceptKey(value)} `;
    const set = new Set<string>();
    for (let i = 0; i < padded.length - 2; i += 1) set.add(padded.slice(i, i + 3));
    return set;
  };

  const first = trigrams(a);
  const second = trigrams(b);
  if (first.size === 0 || second.size === 0) return 0;

  let shared = 0;
  for (const gram of first) if (second.has(gram)) shared += 1;
  return shared / Math.max(first.size, second.size);
}

/** Above this, two titles are the same idea spelled differently. */
export const NEAR_DUPLICATE_THRESHOLD = 0.75;

export function lintWiki(pages: readonly WikiPageRef[]): LintReport {
  const findings: LintFinding[] = [];

  const byTitle = new Map<string, WikiPageRef>();
  const linkTargets = new Set<string>();
  const linkedTo = new Set<string>();

  for (const page of pages) {
    byTitle.set(normalizeTitleKey(page.title), page);
    for (const alias of page.aliases ?? []) byTitle.set(normalizeTitleKey(alias), page);
  }

  // Exact duplicates first — same title, different pages.
  const seenExact = new Map<string, string>();
  for (const page of pages) {
    const key = conceptKey(page.title);
    const first = seenExact.get(key);
    if (first && first !== page.id) {
      findings.push({
        kind: "duplicate",
        severity: "error",
        pageId: page.id,
        relatedPageId: first,
        message: `"${page.title}" already exists as another page.`,
      });
    } else {
      seenExact.set(key, page.id);
    }
  }

  // Near-duplicates, pairwise. Quadratic, but bounded by wiki size and only
  // over pages that are not already exact duplicates.
  const exactDuplicates = new Set(findings.map((finding) => finding.pageId));
  const candidates = pages.filter((page) => !exactDuplicates.has(page.id));
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      const similarity = titleSimilarity(a.title, b.title);
      if (similarity < NEAR_DUPLICATE_THRESHOLD || similarity === 1) continue;
      findings.push({
        kind: "near-duplicate",
        severity: "warning",
        pageId: b.id,
        relatedPageId: a.id,
        message: `"${b.title}" looks like "${a.title}" — merge or add an alias?`,
      });
    }
  }

  for (const page of pages) {
    for (const link of extractWikilinks(page.body)) {
      const target = link.target.trim();
      if (!target) continue;
      linkTargets.add(normalizeTitleKey(target));
      const resolved = byTitle.get(normalizeTitleKey(target));
      if (resolved) {
        linkedTo.add(resolved.id);
        continue;
      }
      findings.push({
        kind: "dead-link",
        severity: "warning",
        pageId: page.id,
        target,
        message: `"${page.title}" links to [[${target}]], which does not exist.`,
      });
    }

    if (contentLength(page.body) < MIN_CONTENT_CHARS) {
      findings.push({
        kind: "empty",
        severity: "info",
        pageId: page.id,
        message: `"${page.title}" has no content of its own yet.`,
      });
    }
  }

  for (const page of pages) {
    if (linkedTo.has(page.id)) continue;
    // A page that links out is participating even if nothing links back; a page
    // with no edges at all is the one that is actually adrift.
    if (extractWikilinks(page.body).length > 0) continue;
    findings.push({
      kind: "orphan",
      severity: "info",
      pageId: page.id,
      message: `"${page.title}" is not linked from anywhere and links nowhere.`,
    });
  }

  const counts: Record<LintKind, number> = {
    duplicate: 0,
    "near-duplicate": 0,
    "dead-link": 0,
    orphan: 0,
    empty: 0,
  };
  for (const finding of findings) counts[finding.kind] += 1;

  return { findings, counts };
}

export interface FixStep {
  kind: LintKind;
  description: string;
  findings: LintFinding[];
}

/**
 * Order fixes so earlier steps do not invalidate later ones.
 *
 * Merging duplicates first is not cosmetic: it removes pages, which resolves
 * some dead links and creates others. Running dead-link repair first would fix
 * links into a page that is about to disappear.
 */
export function planFixOrder(report: LintReport): FixStep[] {
  const by = (kind: LintKind) => report.findings.filter((finding) => finding.kind === kind);

  const steps: FixStep[] = [
    { kind: "duplicate", description: "Merge exact duplicate pages", findings: by("duplicate") },
    { kind: "near-duplicate", description: "Review near-duplicate titles", findings: by("near-duplicate") },
    { kind: "dead-link", description: "Resolve links to missing pages", findings: by("dead-link") },
    { kind: "empty", description: "Fill in pages with no content", findings: by("empty") },
    { kind: "orphan", description: "Connect unlinked pages", findings: by("orphan") },
  ];
  return steps.filter((step) => step.findings.length > 0);
}
