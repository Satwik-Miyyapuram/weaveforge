/**
 * Quick open: type a few letters, get the document.
 *
 * Matching is subsequence-based, like every editor's file palette — "bsl"
 * should find `baselines.note.md` — but a subsequence match alone ranks badly:
 * almost everything matches a three-letter query somewhere, so the results have
 * to be *scored* rather than merely filtered. Prefix and word-start hits win,
 * contiguous runs win, and a match in the filename beats one in the directory
 * it happens to sit under.
 *
 * The kind suffix earns its keep here: typing `.report` narrows to report
 * sections without a filter widget, because the kind is in the text being
 * searched.
 */

import type { WorkspaceTreeNode } from "./workspace-tree";

export interface QuickOpenResult {
  node: WorkspaceTreeNode;
  score: number;
  /** Indices into `node.path` that matched, for highlighting. */
  matched: number[];
}

const MATCH = 8;
const CONTIGUOUS_BONUS = 12;
const WORD_START_BONUS = 10;
const START_BONUS = 16;
/** Charged per skipped character, so a scattered match loses to a tight one. */
const GAP_PENALTY = 1;

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  return /[^a-zA-Z0-9]/.test(text[index - 1]!);
}

/**
 * Score one candidate, or `null` when the query is not a subsequence of it.
 *
 * Greedy left-to-right rather than optimal: an exhaustive best-alignment search
 * is quadratic per candidate and the ranking difference is invisible at the
 * lengths involved, while the cost is not — this runs on every keystroke over
 * every document in the workspace.
 */
export function scoreMatch(text: string, query: string): { score: number; matched: number[] } | null {
  if (!query) return { score: 0, matched: [] };
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  let score = 0;
  let at = 0;
  let previous = -1;
  const matched: number[] = [];

  for (const char of needle) {
    // A space is the user separating terms, not a character to find.
    if (char === " ") continue;
    const found = haystack.indexOf(char, at);
    if (found === -1) return null;

    score += MATCH;
    if (found === previous + 1) score += CONTIGUOUS_BONUS;
    else score -= Math.min((found - at) * GAP_PENALTY, MATCH);
    if (isBoundary(haystack, found)) score += WORD_START_BONUS;
    if (found === 0) score += START_BONUS;

    matched.push(found);
    previous = found;
    at = found + 1;
  }

  // Shorter candidates win ties: `notes/plan.note.md` before
  // `notes/planning/roadmap.note.md` for "plan".
  return { score: score - Math.floor(haystack.length / 12), matched };
}

const MAX_RESULTS = 40;

/**
 * Rank documents against a query.
 *
 * Both the title and the mirrored path are scored, and the better of the two
 * wins — the path carries the kind suffix and the folders, the title is what
 * the user actually remembers. An empty query lists everything, so opening the
 * palette on its own is a workspace listing rather than a blank box.
 */
export function quickOpenResults(
  documents: readonly WorkspaceTreeNode[],
  query: string,
): QuickOpenResult[] {
  const trimmed = query.trim();
  const results: QuickOpenResult[] = [];

  for (const node of documents) {
    const byPath = scoreMatch(node.path, trimmed);
    const byTitle = scoreMatch(node.label, trimmed);
    if (!byPath && !byTitle) continue;
    // A title hit is worth slightly more than the same hit inside a directory
    // name, which is otherwise easy to match by accident.
    const titleScore = byTitle ? byTitle.score + 4 : -Infinity;
    const pathScore = byPath ? byPath.score : -Infinity;
    results.push({
      node,
      score: Math.max(titleScore, pathScore),
      matched: byPath?.matched ?? [],
    });
  }

  results.sort((a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label));
  return results.slice(0, MAX_RESULTS);
}

export interface QuickOpenGroup {
  /** The root the group belongs to, as `kind.ts` names it. */
  kind: string;
  label: string;
  results: QuickOpenResult[];
}

/**
 * Group order: the order of the explorer's roots.
 *
 * Notes, Papers, Lists, Report — the same order the Files section stacks them
 * in, so the palette and the tree agree about what the workspace is made of.
 * Kinds that have no heading yet (an experiment row, say) land at the end in
 * the order they were first seen rather than being dropped.
 */
const GROUP_ORDER: readonly { kind: string; label: string }[] = [
  { kind: "vault_page", label: "Notes" },
  { kind: "paper", label: "Papers" },
  { kind: "reading_list", label: "Reading lists" },
  { kind: "report_section", label: "Report" },
];

/**
 * Split score-ordered hits into groups without re-sorting them.
 *
 * Inside a group the score order is preserved — the best hit is still first,
 * which is what a palette is for — and across groups the root order wins, so
 * Notes do not interleave with Papers.
 */
export function groupResults(results: readonly QuickOpenResult[]): QuickOpenGroup[] {
  const groups: QuickOpenGroup[] = [];
  const byKind = new Map<string, QuickOpenGroup>();

  for (const entry of GROUP_ORDER) {
    const group: QuickOpenGroup = { kind: entry.kind, label: entry.label, results: [] };
    groups.push(group);
    byKind.set(entry.kind, group);
    const found = results.filter((result) => result.node.kind === entry.kind);
    group.results.push(...found);
  }

  for (const result of results) {
    if (byKind.has(result.node.kind)) continue;
    let group = byKind.get(result.node.kind);
    if (!group) {
      group = { kind: result.node.kind, label: titleCase(result.node.kind), results: [] };
      byKind.set(result.node.kind, group);
      groups.push(group);
    }
    group.results.push(result);
  }

  return groups.filter((group) => group.results.length > 0);
}

function titleCase(text: string): string {
  const words = text.replace(/[_-]+/g, " ").trim().split(/\s+/);
  return words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
}
