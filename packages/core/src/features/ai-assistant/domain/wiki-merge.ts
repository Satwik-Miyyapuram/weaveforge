/**
 * Merging two wiki pages into one.
 *
 * Merging is lossy by nature, so the rule here is that nothing is ever dropped
 * silently. Content that appears in both survives once; content unique to
 * either survives; and statements that disagree are kept side by side and
 * flagged rather than resolved. Picking a winner between two contradictory
 * sentences is exactly the judgement a merge tool should not make on its own.
 */

import { conceptKey } from "./ai-extraction.js";

export interface MergeInput {
  id: string;
  title: string;
  body: string;
  aliases?: readonly string[];
  sources?: readonly string[];
}

export interface Contradiction {
  /** The statement from the page being kept. */
  fromPrimary: string;
  /** The conflicting statement from the page being merged in. */
  fromSecondary: string;
}

export interface MergeResult {
  title: string;
  body: string;
  aliases: string[];
  sources: string[];
  contradictions: Contradiction[];
}

/** Split prose into comparable statements. */
function statements(body: string): string[] {
  return body
    .replace(/^---[\s\S]*?---/, "")
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^#{1,6}\s/.test(line) && !/^>/.test(line));
}

/** Words that flip a statement's meaning; two otherwise-similar lines differing
 *  on one of these are asserting opposite things. */
const NEGATIONS = /\b(not|no|never|cannot|can't|doesn't|does not|isn't|is not|without|fails?|worse|lower|decreases?)\b/i;

function similarity(a: string, b: string): number {
  const words = (value: string) => new Set(conceptKey(value).split(/\s+/).filter((w) => w.length > 3));
  const first = words(a);
  const second = words(b);
  if (first.size === 0 || second.size === 0) return 0;
  let shared = 0;
  for (const word of first) if (second.has(word)) shared += 1;
  return shared / Math.max(first.size, second.size);
}

/** Similar wording but opposite polarity — the signature of a contradiction. */
const CONTRADICTION_SIMILARITY = 0.6;

function contradicts(a: string, b: string): boolean {
  if (similarity(a, b) < CONTRADICTION_SIMILARITY) return false;
  return NEGATIONS.test(a) !== NEGATIONS.test(b);
}

/**
 * Merge `secondary` into `primary`.
 *
 * `primary` keeps its title; the other title becomes an alias, so links to
 * either continue to resolve after the merge.
 */
export function mergeWikiPages(primary: MergeInput, secondary: MergeInput): MergeResult {
  const primaryStatements = statements(primary.body);
  const secondaryStatements = statements(secondary.body);

  const contradictions: Contradiction[] = [];
  const additions: string[] = [];

  for (const candidate of secondaryStatements) {
    const conflict = primaryStatements.find((existing) => contradicts(existing, candidate));
    if (conflict) {
      contradictions.push({ fromPrimary: conflict, fromSecondary: candidate });
      continue;
    }
    // Near-identical statements are the same claim written twice.
    const duplicate = primaryStatements.some((existing) => similarity(existing, candidate) >= 0.85);
    if (!duplicate) additions.push(candidate);
  }

  const body: string[] = [primary.body.trimEnd()];

  if (additions.length > 0) {
    body.push("", `## From ${secondary.title}`, "", ...additions);
  }

  if (contradictions.length > 0) {
    body.push("", "## Conflicting notes", "");
    body.push(
      "> These statements disagree. Both are kept until someone decides which is right.",
      "",
    );
    for (const conflict of contradictions) {
      body.push(`- **${primary.title}:** ${conflict.fromPrimary}`);
      body.push(`- **${secondary.title}:** ${conflict.fromSecondary}`);
      body.push("");
    }
  }

  const aliases = [
    ...new Set([
      ...(primary.aliases ?? []),
      ...(secondary.aliases ?? []),
      // The absorbed title has to stay resolvable, or every link to it dies.
      secondary.title,
    ]),
  ].filter((alias) => conceptKey(alias) !== conceptKey(primary.title));

  return {
    title: primary.title,
    body: body.join("\n").trimEnd(),
    aliases,
    sources: [...new Set([...(primary.sources ?? []), ...(secondary.sources ?? [])])],
    contradictions,
  };
}
