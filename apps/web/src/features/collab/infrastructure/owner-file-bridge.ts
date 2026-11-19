/**
 * Decision rules of the owner-file bridge (L9), as pure functions.
 *
 * The digest log is keyed by workspace-relative path: one list of digests per
 * file, never by entity id. A pulled or externally edited file is skipped only
 * when the pull listed it AND its digest is already in that file's log, which is
 * how a late pull of an old save is told apart from a deliberate revert (a
 * revert is not a pull, so it is never listed).
 */

export const RENEW_EVERY_MS = 30_000;
/** A lease holder stops writing once its renewals have failed this long. */
export const WRITE_STOP_AFTER_FAILED_MS = 60_000;
/** Another desktop may take the lease once the last good renewal is this old. */
export const TAKEOVER_AFTER_MS = 90_000;

export type PullDecision =
  | { action: "skip"; reason: "not-diffed" | "digest-listed" | "unchanged" }
  | { action: "apply"; text: string; digest: string }
  | { action: "conflict-copy"; reason: "half-delete" | "no-base" | "digest-log-unreadable"; digest: string };

export interface PullInput {
  /** Two reads of the file; a half-written file shows up as a disagreement. */
  reads: readonly [string | null, string | null];
  /** True when a pull-batch event listed this file. */
  listedByPull: boolean;
  /** The file's digest log, or `null` when the log cannot be read. */
  digestLog: readonly string[] | null;
  /** The last text this device wrote or read, or `null` when there is none. */
  base: string | null;
  digest: (text: string) => string;
}

/** The digests recorded for one workspace-relative path; `[]` when none are. */
export function digestsFor(
  log: ReadonlyMap<string, readonly string[]>,
  relPath: string,
): readonly string[] {
  return log.get(relPath) ?? [];
}

/** Characters kept from both ends of `base` in `text`, never overlapping. */
function keptChars(base: string, text: string): number {
  const limit = Math.min(base.length, text.length);
  let prefix = 0;
  while (prefix < limit && base[prefix] === text[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    base[base.length - 1 - suffix] === text[text.length - 1 - suffix]
  ) {
    suffix++;
  }
  return prefix + suffix;
}

/** True when the text is shorter than the base and more than half of the base is gone. */
function isHalfDelete(base: string, text: string): boolean {
  if (text.length >= base.length) return false;
  const removed = base.length - keptChars(base, text);
  return removed * 2 > base.length;
}

/** Decides what a pulled or externally edited file means for the document. */
export function decidePulledText(input: PullInput): PullDecision {
  const [first, second] = input.reads;
  // Absent, empty over a non-empty base, or still being written: never diffed.
  if (first === null || second === null || first !== second) {
    return { action: "skip", reason: "not-diffed" };
  }
  if (first === "" && input.base !== null && input.base !== "") {
    return { action: "skip", reason: "not-diffed" };
  }
  if (input.base !== null && first === input.base) {
    return { action: "skip", reason: "unchanged" };
  }
  const digest = input.digest(first);
  if (input.digestLog === null) {
    return { action: "conflict-copy", reason: "digest-log-unreadable", digest };
  }
  if (input.listedByPull && input.digestLog.includes(digest)) {
    return { action: "skip", reason: "digest-listed" };
  }
  if (input.base === null) {
    return { action: "conflict-copy", reason: "no-base", digest };
  }
  if (isHalfDelete(input.base, first)) {
    return { action: "conflict-copy", reason: "half-delete", digest };
  }
  return { action: "apply", text: first, digest };
}

export type WriteBackResult = { status: "written" } | { status: "changed"; diskText: string };

/**
 * A `Changed` result from `file_write` means the disk text moved on under us: it
 * goes through the read side, and is never overwritten.
 */
export function afterWriteBack(
  result: WriteBackResult,
  readSide: (text: string) => PullDecision,
): PullDecision {
  if (result.status === "changed") return readSide(result.diskText);
  return { action: "skip", reason: "unchanged" };
}

/** Unsaved edits are written before the session closes; nothing is written if there are none. */
export async function flushBeforeClose(
  unsaved: string | null,
  write: (text: string) => Promise<void>,
): Promise<void> {
  if (unsaved !== null) await write(unsaved);
}

/** Two-part extensions that name a file type; the conflict stamp goes before them. */
const COMPOUND_EXTENSIONS = [".ink.md", ".annotations.json"];

/** Characters Windows forbids in a file name, plus control characters. */
const UNSAFE_IN_FILE_NAME = /[<>:"/\\|?*\u0000-\u001f]/;

/** `notes/day one.md` becomes `notes/day one (conflict <stamp>).md`. */
export function conflictCopyPath(relPath: string, stamp: string): string {
  if (stamp === "" || UNSAFE_IN_FILE_NAME.test(stamp) || /[. ]$/.test(stamp)) {
    throw new Error(`conflict stamp ${JSON.stringify(stamp)} is not a safe file name part`);
  }
  const slash = relPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : relPath.slice(0, slash + 1);
  const name = relPath.slice(slash + 1);
  const compound = COMPOUND_EXTENSIONS.find((ext) => name.length > ext.length && name.endsWith(ext));
  if (compound) {
    return `${dir}${name.slice(0, -compound.length)} (conflict ${stamp})${compound}`;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const ext = dot <= 0 ? "" : name.slice(dot);
  return `${dir}${stem} (conflict ${stamp})${ext}`;
}

/**
 * Lease bookkeeping for the holder. Writes stop once renewals have failed for
 * `WRITE_STOP_AFTER_FAILED_MS`; a good renewal clears the failure.
 */
export class LeaseHolder {
  private failingSince: number | null = null;

  constructor(private lastRenewed: number) {}

  /** Records a renewal attempt at `now`. */
  renewal(now: number, ok: boolean): void {
    if (ok) {
      this.lastRenewed = now;
      this.failingSince = null;
    } else {
      this.failingSince ??= now;
    }
  }

  canWrite(now: number): boolean {
    return this.failingSince === null || now - this.failingSince < WRITE_STOP_AFTER_FAILED_MS;
  }

  /** Another desktop may take the lease once the last good renewal is old enough. */
  static canTakeOver(renewedAt: number, now: number): boolean {
    return now - renewedAt >= TAKEOVER_AFTER_MS;
  }
}
