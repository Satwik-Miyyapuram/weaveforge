import { rust } from "../shared/rust.js";

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

/** A short, stable digest of a file's text. Change detection only. Rust `digest_text`. */
export function digestText(text: string): string {
  return rust().digestText(text);
}

export type ChangeSide = "neither" | "folder" | "workspace" | "both" | "unknown";
