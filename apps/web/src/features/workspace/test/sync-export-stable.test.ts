import assert from "node:assert/strict";
import { test } from "node:test";

import { SYNC_TABLES, exportSyncTablesStable, type SyncRow, type SyncTableReader } from "../application/sync-tables";

/**
 * G5: a sync to the folder reads every table. A write that lands between two
 * table reads would give a folder that matches no single moment in the database.
 * The stable export reads the whole set again until two passes agree.
 */

/** A reader whose papers table changes on each pass; `pass` counts from 1 at the first table read of a pass. */
function readerWithPapers(papersFor: (pass: number) => number): SyncTableReader {
  let pass = 0;
  return async (table) => {
    if (table === SYNC_TABLES[0]) pass += 1;
    if (table === "papers") {
      return Array.from({ length: papersFor(pass) }, (_, i) => ({ id: `paper-${i}` }) as SyncRow);
    }
    return [];
  };
}

test("a stable database exports in two passes and returns the same rows", async () => {
  let reads = 0;
  const read: SyncTableReader = async (table) => {
    reads += 1;
    return table === "papers" ? [{ id: "a" }] : [];
  };
  const out = await exportSyncTablesStable(read);
  assert.deepEqual(out.papers, [{ id: "a" }]);
  assert.equal(reads, SYNC_TABLES.length * 2, "one extra full pass to confirm the first");
});

test("a write between passes is read again, and the returned rows are from a pass that agrees", async () => {
  // Pass 1 sees one paper, pass 2 sees two, pass 3 sees two: pass 2 and 3 agree, so pass 3 is returned.
  const out = await exportSyncTablesStable(readerWithPapers((pass) => Math.min(pass, 2)));
  assert.equal(out.papers.length, 2);
});

test("a database that never settles makes the export fail rather than write a mixed folder", async () => {
  await assert.rejects(
    exportSyncTablesStable(readerWithPapers((pass) => pass), 3),
    /changed while the folder was being written/,
  );
});
