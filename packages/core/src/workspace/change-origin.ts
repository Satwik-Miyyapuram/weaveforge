/**
 * Telling apart "the folder changed" from "the workspace changed".
 *
 * Without this the import diff can only say that two copies of a note differ,
 * which is not enough to act on: applying a difference that came from the
 * workspace's own side overwrites a real edit with an older copy, and the user
 * has no way back. What is missing is the third side -- the note as it stood
 * when the two last agreed, which is exactly what the mirror wrote.
 *
 * So each mirror run records a digest of every file it left in the folder, and
 * the next import compares three digests rather than two texts:
 *
 * - the folder's copy differs from the base -> somebody edited it out there
 * - the workspace's copy differs from the base -> somebody edited it in here
 * - both -> a conflict, which is asked about rather than resolved
 *
 * The digest is FNV-1a, not a cryptographic hash, and deliberately so. It is
 * only ever compared against a value this app produced from the same text on
 * the same machine; nothing is authenticated by it, and a collision costs a
 * missed change rather than a forged one. A crypto digest would mean either a
 * dependency or an async API in a path that is otherwise plain string work.
 */

/** A short, stable digest of a file's text. Change detection only. */
export function digestText(text: string): string {
  // 64 bits as two 32-bit halves: JavaScript numbers cannot hold a 64-bit
  // integer, and two independent 32-bit walks are cheaper than BigInt.
  let low = 0x811c9dc5;
  let high = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    low = Math.imul(low ^ code, 0x01000193);
    high = Math.imul(high ^ (code + index), 0x85ebca6b);
  }
  return `${(low >>> 0).toString(16).padStart(8, "0")}${(high >>> 0).toString(16).padStart(8, "0")}`;
}

/** What the two sides look like now, against what they last agreed on. */
export interface ChangeOrigin {
  /** Digest of the file the last mirror run left in the folder, if known. */
  base?: string;
  /** Digest of the folder's copy as it reads now. */
  folder?: string;
  /** Digest of the file the mirror would write from the workspace now. */
  workspace?: string;
}

export type ChangeSide = "neither" | "folder" | "workspace" | "both" | "unknown";

/**
 * Who changed the file since the two sides last agreed.
 *
 * `unknown` where there is no base -- a folder written by an older version, a
 * manifest that was lost, a file the mirror never wrote. The caller must treat
 * it as it treated everything before this existed, which is to say: show the
 * difference and let the user decide.
 */
export function changedSide(origin: ChangeOrigin): ChangeSide {
  const { base, folder, workspace } = origin;
  if (base === undefined || folder === undefined || workspace === undefined) return "unknown";
  const folderMoved = folder !== base;
  const workspaceMoved = workspace !== base;
  if (folderMoved && workspaceMoved) return folder === workspace ? "neither" : "both";
  if (folderMoved) return "folder";
  if (workspaceMoved) return "workspace";
  return "neither";
}
