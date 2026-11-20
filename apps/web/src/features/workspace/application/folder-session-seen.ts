/**
 * What this session last mirrored into the folder, per project: path -> digest of the
 * database content. The mirror rewrites an existing file only when its item changed in the
 * app since this record was taken, so nothing is written over a file on the first run after
 * start, after a database replace, or after an import.
 *
 * Memory only, by design: a fresh start has no record, and the first mirror then writes no
 * existing file. The record is never read from disk or the database.
 *
 * A generation counts the forgets. A mirror reads the generation with its record and records
 * its result only if no forget happened since, so a run that was already in flight when the
 * database was replaced cannot put its stale digests back.
 */
const seenByProject = new Map<string, Readonly<Record<string, string>>>();
let generation = 0;

/** The record for this project, or undefined when this session has not mirrored it yet. */
export function sessionSeen(projectId: string): Readonly<Record<string, string>> | undefined {
  return seenByProject.get(projectId);
}

/** The current generation. Read it together with `sessionSeen`, and pass it to `recordSessionSeen`. */
export function sessionGeneration(): number {
  return generation;
}

/**
 * Replace the record with what the run just mirrored. Ignored when the database was forgotten
 * since `startedAt` was read: the run's digests describe a database that no longer exists.
 */
export function recordSessionSeen(
  projectId: string,
  served: Readonly<Record<string, string>>,
  startedAt: number,
): void {
  if (startedAt !== generation) return;
  seenByProject.set(projectId, served);
}

/** Drop every record: the database was replaced or re-imported, so the next mirror starts from nothing. */
export function forgetSessionSeen(): void {
  seenByProject.clear();
  generation += 1;
}
