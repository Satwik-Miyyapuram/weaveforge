/**
 * Diffing a note's body, and the markers that hand it to an editor.
 *
 * The folder and the workspace can both change one note's prose. The merge for
 * frontmatter is per key over a recorded base (`merge-vault-page`), but a body
 * has no base: the manifest keeps a digest of it and deliberately not a copy,
 * because keeping every note's text twice to buy a three-way body merge is a
 * doubled vault against the one field a person can settle by reading it. So the
 * body is settled by showing the two copies — this is `git diff`'s shape, minus
 * the `|||||||` section, exactly as git falls back when it has no merge base.
 *
 * Line diffs are a plain longest-common-subsequence. Notes are prose and small;
 * past a ceiling this stops trying and reports one hunk holding both copies
 * whole, which is honest, bounded and still resolvable — the alternative is a
 * quadratic table sized by whatever somebody pasted into a note.
 */

/** One line of the interleaved view: ours, theirs, or agreed. */
export interface DiffLine {
  op: "same" | "ours" | "theirs";
  text: string;
}

/**
 * A run of disagreeing lines.
 *
 * `ours` and `theirs` are the lines each side has in this run, in order; either
 * may be empty (a pure insertion on one side). Everything between two hunks is
 * identical on both sides and is never a choice.
 */
export interface DiffHunk {
  index: number;
  ours: string[];
  theirs: string[];
}

export interface BodyDiff {
  lines: DiffLine[];
  hunks: DiffHunk[];
}

/** What a hunk may be resolved to. Anything else is not a resolution. */
export type HunkPick = "ours" | "theirs" | "both";

/**
 * The ceiling on the LCS table, in cells.
 *
 * 4M cells is about 2,000 lines against 2,000 lines — far past any note that is
 * still a note, and about 32 MB of numbers if it were reached, which is why it
 * is not.
 */
const MAX_DIFF_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  return text.split("\n");
}

/** The interleaved line view, with no hunk grouping. */
function diffLines(oursText: string, theirsText: string): DiffLine[] {
  const ours = splitLines(oursText);
  const theirs = splitLines(theirsText);
  const n = ours.length;
  const m = theirs.length;

  // Past the ceiling there is no clever answer worth the memory: one run holding
  // both copies whole, which the UI shows as a single hunk to pick from.
  if (n * m > MAX_DIFF_CELLS) {
    return [
      ...ours.map((text) => ({ op: "ours" as const, text })),
      ...theirs.map((text) => ({ op: "theirs" as const, text })),
    ];
  }

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        ours[i] === theirs[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ours[i] === theirs[j]) {
      out.push({ op: "same", text: ours[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ op: "ours", text: ours[i]! });
      i += 1;
    } else {
      out.push({ op: "theirs", text: theirs[j]! });
      j += 1;
    }
  }
  while (i < n) out.push({ op: "ours", text: ours[i++]! });
  while (j < m) out.push({ op: "theirs", text: theirs[j++]! });
  return out;
}

/** The interleaved lines, grouped into the runs a person chooses between. */
export function diffBody(oursText: string, theirsText: string): BodyDiff {
  const lines = diffLines(oursText, theirsText);
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;

  for (const line of lines) {
    if (line.op === "same") {
      current = null;
      continue;
    }
    if (!current) {
      current = { index: hunks.length, ours: [], theirs: [] };
      hunks.push(current);
    }
    (line.op === "ours" ? current.ours : current.theirs).push(line.text);
  }

  return { lines, hunks };
}

/**
 * Compose the body from a choice per hunk.
 *
 * An unchosen hunk keeps ours, which is the same direction the rest of this
 * feature defaults in: an unsettled difference leaves what is already in the
 * app, and never writes a guess.
 */
export function mergeHunks(
  oursText: string,
  theirsText: string,
  picks: Readonly<Record<number, HunkPick>> = {},
): string {
  const lines = diffLines(oursText, theirsText);
  const out: string[] = [];
  let index = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.op === "same") {
      out.push(line.text);
      i += 1;
      continue;
    }
    const ours: string[] = [];
    const theirs: string[] = [];
    let j = i;
    while (j < lines.length && lines[j]!.op !== "same") {
      (lines[j]!.op === "ours" ? ours : theirs).push(lines[j]!.text);
      j += 1;
    }
    const pick = picks[index] ?? "ours";
    if (pick === "theirs") out.push(...theirs);
    else if (pick === "both") out.push(...ours, ...theirs);
    else out.push(...ours);
    index += 1;
    i = j;
  }

  return out.join("\n");
}

/**
 * The markers this app writes.
 *
 * Labelled with both sides rather than `HEAD`/`branch`, because the two copies
 * are not two git refs and a person reading the file should not have to work out
 * which is which. The labels are exact and are what detection matches on.
 */
export const MARKER_OURS = "<<<<<<< this app";
export const MARKER_SEPARATOR = "=======";
export const MARKER_THEIRS = ">>>>>>> the folder";

/** The two copies, marked, for a person to settle in whatever they edit in. */
export function writeConflictMarkers(oursText: string, theirsText: string): string {
  return [MARKER_OURS, oursText, MARKER_SEPARATOR, theirsText, MARKER_THEIRS].join("\n");
}

/**
 * Whether a body still holds this app's markers.
 *
 * Both labels are required, in order, and matched from the start of a line.
 * A bare run of `=======` is a setext heading in ordinary markdown, so matching
 * it alone would call a large part of a normal vault conflicted.
 */
export function hasConflictMarkers(text: string): boolean {
  const lines = splitLines(text);
  const open = lines.findIndex((line) => line.startsWith(MARKER_OURS));
  if (open < 0) return false;
  return lines.slice(open + 1).some((line) => line.startsWith(MARKER_THEIRS));
}
