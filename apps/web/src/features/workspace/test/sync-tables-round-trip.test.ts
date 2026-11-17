/**
 * A folder-mirror clone must rebuild the whole database, not only notes,
 * canvases, ink and assets. Seed every synced table in one database, export
 * the rows to `.weaveforge/tables/<table>.json` files, import the files into an
 * empty database, and expect the same rows back, table by table.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

import type { WorkspaceSnapshot } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

import { freshTestDb, testDb, type TestDb } from "../../../backend/test/pg-test-db";
import { mirrorWorkspace } from "../application/parts-2";
import { restoreThenImport } from "../application/workspace-folder";
import {
  SYNC_TABLES,
  exportSyncTables,
  importSyncTables,
  OMITTED_GENERATED,
  restoreSyncTables,
  sqlTableReader,
  type SyncRow,
  type SyncTable,
  type SyncTableStore,
  syncTableFile,
  syncTableFolderFiles,
  syncTableRowsFromFolder,
} from "../application/sync-tables";

type Row = Record<string, unknown>;

const P = "a0000000-0000-4000-8000-000000000001"; // project
const PAPER_1 = "a0000000-0000-4000-8000-000000000002";
const PAPER_2 = "a0000000-0000-4000-8000-000000000003";
const TAG = "a0000000-0000-4000-8000-000000000004";
const LIST = "a0000000-0000-4000-8000-000000000005";
const NOTE = "a0000000-0000-4000-8000-000000000006";
const SECTION = "a0000000-0000-4000-8000-000000000007";
const ITEM = "a0000000-0000-4000-8000-000000000008";
const EXPERIMENT = "a0000000-0000-4000-8000-000000000009";
const FIELD = "a0000000-0000-4000-8000-00000000000a";

/** One or more rows for every table in SYNC_TABLES. */
async function seed(db: TestDb, uid: string): Promise<void> {
  const q = (text: string, params: unknown[] = []) => db.sql(text, params);
  await q(`insert into projects (id, user_id, name) values ($1, $2, 'Lab')`, [P, uid]);
  await q(`insert into tags (id, user_id, project_id, name) values ($1, $2, $3, 'ml')`, [TAG, uid, P]);
  await q(`insert into papers (id, user_id, project_id, title) values ($1, $2, $3, 'Paper one'), ($4, $2, $3, 'Paper two')`, [PAPER_1, uid, P, PAPER_2]);
  await q(`insert into paper_tags (paper_id, tag_id) values ($1, $2)`, [PAPER_1, TAG]);
  await q(`insert into vault_pages (id, user_id, project_id, title) values ($1, $2, $3, 'Note')`, [NOTE, uid, P]);
  await q(`insert into reading_lists (id, user_id, project_id, name) values ($1, $2, $3, 'To read')`, [LIST, uid, P]);
  await q(`insert into report_sections (id, user_id, project_id, title) values ($1, $2, $3, 'Results')`, [SECTION, uid, P]);
  await q(`insert into reading_list_items (id, list_id, paper_id) values ($1, $2, $3)`, [ITEM, LIST, PAPER_1]);
  await q(`insert into screening_decisions (item_id, reviewer_id, state) values ($1, $2, 'included')`, [ITEM, uid]);
  await q(`insert into paper_relations (user_id, project_id, from_paper, to_paper, relation) values ($1, $2, $3, $4, 'cites')`, [uid, P, PAPER_1, PAPER_2]);
  await q(`insert into experiments (id, user_id, project_id, name, related_paper) values ($1, $2, $3, 'Run 1', $4)`, [EXPERIMENT, uid, P, PAPER_1]);
  await q(`insert into experiment_metric_names (id, name) values (1, 'loss')`);
  await q(`insert into experiment_metric_points (experiment_id, user_id, metric_id, step, value) values ($1, $2, 1, 0, 0.5)`, [EXPERIMENT, uid]);
  await q(
    `insert into experiment_metric_chunks (experiment_id, user_id, metric_id, chunk_no, steps, "values", wall_times)
     values ($1, $2, 1, 0, '{0,1}', '{0.5,0.4}', '{2026-01-01T00:00:00Z,2026-01-01T00:00:01Z}')`,
    [EXPERIMENT, uid],
  );
  await q(`insert into milestones (id, user_id, project_id, title) values (gen_random_uuid(), $1, $2, 'Draft')`, [uid, P]);
  await q(`insert into log_entries (user_id, project_id, body) values ($1, $2, 'Met advisor')`, [uid, P]);
  await q(`insert into paper_field_defs (id, user_id, project_id, name, kind) values ($1, $2, $3, 'Score', 'number')`, [FIELD, uid, P]);
  await q(`insert into paper_field_values (user_id, project_id, paper_id, field_id, value) values ($1, $2, $3, $4, '5'::jsonb)`, [uid, P, PAPER_1, FIELD]);
  await q(`insert into paper_locus_anchors (user_id, project_id, paper_id, anchor_key, content) values ($1, $2, $3, 'p3', '{"page":3}'::jsonb)`, [uid, P, PAPER_1]);
  await q(`insert into reader_annotations (user_id, project_id, paper_id, type, anchor, page_index) values ($1, $2, $3, 'highlight', '{"quote":"x"}'::jsonb, 2)`, [uid, P, PAPER_1]);
  await q(`insert into annotation_pins (user_id, project_id, paper_id, report_section_id, annotation_key) values ($1, $2, $3, $4, 'k1')`, [uid, P, PAPER_1, SECTION]);
  await q(`insert into annotation_quotation_types (user_id, project_id, paper_id, annotation_key, quotation_type) values ($1, $2, $3, 'k1', 'direct')`, [uid, P, PAPER_1]);
  await q(`insert into citation_alert_tracks (user_id, project_id, paper_id) values ($1, $2, $3)`, [uid, P, PAPER_1]);
  await q(`insert into lab_snapshots (user_id, project_id, title, content) values ($1, $2, 'Week 1', '{"v":1}'::jsonb)`, [uid, P]);
  await q(`insert into blob_objects (user_id, bucket, path) values ($1, 'assets', 'p/diagram.webp')`, [uid]);
}

/**
 * The sync stamps are the receiving database's own bookkeeping: its trigger
 * sets server_seq and row_version on every write, so an import gets fresh ones.
 * Everything else must match exactly.
 */
const LOCAL_STAMPS = ["server_seq", "row_version"];

/** Rows as JSON text, sorted, so two databases compare by content. */
async function snapshot(db: TestDb, table: string): Promise<string[]> {
  const rows = await db.sql<Row>(`select * from ${table}`);
  return rows
    .map((row) => {
      const kept = Object.fromEntries(Object.entries(row).filter(([k]) => !LOCAL_STAMPS.includes(k)));
      return JSON.stringify(kept);
    })
    .sort();
}

test("every synced table survives export to folder files and import into an empty database", async () => {
  const src = await testDb();
  const uid = await src.createUser("mirror@test.invalid");
  await seed(src, uid);

  const dst = await freshTestDb();
  await dst.sql(`insert into auth.users (id, email) values ($1, 'mirror@test.invalid')`, [uid]);

  const exported = await exportSyncTables(sqlTableReader(src));
  const dir = await mkdtemp(path.join(os.tmpdir(), "sync-tables-"));
  try {
    // The folder is the only thing a clone receives: write its files, read them back, import them.
    for (const [file, text] of Object.entries(syncTableFolderFiles(exported))) {
      const full = path.join(dir, file);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, text, "utf8");
    }
    const folder: Record<string, string> = {};
    for (const table of SYNC_TABLES) {
      const file = syncTableFile(table);
      folder[file] = await readFile(path.join(dir, file), "utf8");
    }
    await importSyncTables(dst, syncTableRowsFromFolder(folder));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  for (const table of SYNC_TABLES) {
    const before = await snapshot(src, table);
    const after = await snapshot(dst, table);
    assert.equal(after.length, before.length, `${table}: row count`);
    assert.ok(before.length > 0, `${table}: seed must contain a row`);
    assert.deepEqual(after, before, `${table}: rows equal`);
  }

  // Sample row: a known paper arrives with its title, not just a matching hash.
  const sample = await dst.sql<{ title: string }>(`select title from papers where id = $1`, [PAPER_1]);
  assert.equal(sample[0]?.title, "Paper one");
});

test("the folder file for a table lives under .weaveforge/tables", () => {
  assert.equal(syncTableFile("papers"), ".weaveforge/tables/papers.json");
});

// The real folder path: the mirror writes the table files beside the workspace
// files, the folder is read back as a clone would read it, and the rows come back.
const MIRROR_PROJECT = { id: P, name: "Lab" };
const MIRROR_AT = "2026-11-17T00:00:00.000Z";
let mirrorCore: RustCore;
before(async () => {
  mirrorCore = await loadTestCore();
});

test("the mirror writes every table file into the folder and a clone rebuilds from them", async () => {
  const src = await freshTestDb();
  const uid = await src.createUser("mirror@test.invalid");
  await seed(src, uid);
  const tableFiles = syncTableFolderFiles(await exportSyncTables(sqlTableReader(src)));

  const folder = new MemoryWorkspaceFs(() => MIRROR_AT);
  const emptySnapshot: WorkspaceSnapshot = {
    papers: [], vaultPages: [], readingLists: [], readingListItems: [],
    reportSections: [], experiments: [], milestones: [], logEntries: [],
    relations: [], tags: [], readerAnnotations: [], collectedAt: MIRROR_AT,
  };
  await mirrorWorkspace(mirrorCore, emptySnapshot, folder, { project: MIRROR_PROJECT, extraFiles: tableFiles });

  const record = folder.toRecord();
  const folderFiles: Record<string, string> = {};
  for (const table of SYNC_TABLES) {
    const file = syncTableFile(table);
    assert.ok(record[file] !== undefined, `${file} is written into the folder`);
    folderFiles[file] = record[file] as string;
  }

  const dst = await freshTestDb();
  await dst.sql(`insert into auth.users (id, email) values ($1, 'mirror@test.invalid')`, [uid]);
  await importSyncTables(dst, syncTableRowsFromFolder(folderFiles));
  for (const table of SYNC_TABLES) {
    assert.deepEqual(await snapshot(dst, table), await snapshot(src, table), `${table}: rows equal`);
  }
});

// The restore path used by the app: the same rows through a store that writes
// plain inserts, generated columns left out. The PGlite store stands in for the
// PostgREST client, which cannot run in tests.
function pgliteStore(db: TestDb): SyncTableStore {
  return {
    async isEmpty(table: SyncTable) {
      const rows = await db.sql<{ n: number }>(`select count(*)::int as n from ${table}`);
      return rows[0]?.n === 0;
    },
    async rows(table: SyncTable, columns: readonly string[]) {
      const list = columns.map((c) => `"${c}"`).join(", ");
      return db.sql<SyncRow>(`select ${list} from ${table}`);
    },
    async insert(table: SyncTable, rows: SyncRow[]) {
      const cols = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      const list = cols.map((c) => `"${c}"`).join(", ");
      await db.sql(
        `insert into ${table} (${list}) select ${list} from json_populate_recordset(null::${table}, $1::json)`,
        [JSON.stringify(rows)],
      );
    },
  };
}

test("the restore into an empty database through plain inserts rebuilds every table", async () => {
  const src = await freshTestDb();
  const uid = await src.createUser("restore@test.invalid");
  await seed(src, uid);
  const tableFiles = syncTableFolderFiles(await exportSyncTables(sqlTableReader(src)));
  const rows = syncTableRowsFromFolder(tableFiles);

  const dst = await freshTestDb();
  await dst.sql(`insert into auth.users (id, email) values ($1, 'restore@test.invalid')`, [uid]);
  await restoreSyncTables(rows, pgliteStore(dst));
  for (const table of SYNC_TABLES) {
    assert.deepEqual(await snapshot(dst, table), await snapshot(src, table), `${table}: rows equal`);
  }
});

test("a restore refuses a database that holds rows the folder does not have", async () => {
  const src = await freshTestDb();
  const uid = await src.createUser("restore2@test.invalid");
  await seed(src, uid);
  const rows = syncTableRowsFromFolder(syncTableFolderFiles(await exportSyncTables(sqlTableReader(src))));
  // The database holds the projects; a folder without them is a database with rows the folder lacks.
  await assert.rejects(restoreSyncTables({ ...rows, projects: [] }, pgliteStore(src)), /already has rows/);
});

test("a restore into the database the folder was exported from keeps every row and writes nothing new", async () => {
  const src = await freshTestDb();
  const uid = await src.createUser("restore3@test.invalid");
  await seed(src, uid);
  const before = await snapshot(src, "papers");
  const rows = syncTableRowsFromFolder(syncTableFolderFiles(await exportSyncTables(sqlTableReader(src))));
  await restoreSyncTables(rows, pgliteStore(src));
  assert.deepEqual(await snapshot(src, "papers"), before, "an already-restored table is not written again");
});

test("the generated columns left out of a restore are exactly the stored generated columns of synced tables", async () => {
  const db = await testDb();
  const generated = await db.sql<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and is_generated = 'ALWAYS'`,
  );
  const synced = new Set<string>(SYNC_TABLES);
  const found = generated
    .filter((c) => synced.has(c.table_name))
    .map((c) => `${c.table_name}.${c.column_name}`)
    .sort();
  const omitted = Object.entries(OMITTED_GENERATED)
    .flatMap(([table, cols]) => (cols ?? []).map((c) => `${table}.${c}`))
    .sort();
  assert.deepEqual(omitted, found);
});

test("no synced table has an identity column that refuses explicit values", async () => {
  const db = await testDb();
  const always = await db.sql<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and identity_generation = 'ALWAYS'`,
  );
  const synced = new Set<string>(SYNC_TABLES);
  assert.deepEqual(always.filter((c) => synced.has(c.table_name)), []);
});

test("a clone restores the tables first, then diffs the folder against the restored rows", async () => {
  const src = await freshTestDb();
  const uid = await src.createUser("order@test.invalid");
  await seed(src, uid);
  const rows = syncTableRowsFromFolder(syncTableFolderFiles(await exportSyncTables(sqlTableReader(src))));

  const dst = await freshTestDb();
  await dst.sql(`insert into auth.users (id, email) values ($1, 'order@test.invalid')`, [uid]);
  const events: string[] = [];
  const inner = pgliteStore(dst);
  const store: SyncTableStore = {
    isEmpty: (table) => inner.isEmpty(table),
    rows: (table, columns) => inner.rows(table, columns),
    insert: async (table, batch) => {
      events.push(`insert:${table}`);
      await inner.insert(table, batch);
    },
  };
  let applied: unknown = "not applied";
  await restoreThenImport({
    store,
    tables: rows,
    preview: async () => {
      events.push("preview");
      return { entries: [], json: { entries: [{ kind: "relations" }], counts: {} } } as never;
    },
    apply: async (diff) => {
      events.push("apply");
      applied = diff;
    },
  });
  const lastInsert = events.map((e, i) => (e.startsWith("insert:") ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  assert.ok(lastInsert >= 0, "the restore wrote rows");
  assert.ok(events.indexOf("preview") > lastInsert, "the folder is diffed after the restore");
  assert.equal(events.at(-1), "apply");
  assert.equal((applied as { json?: unknown }).json, undefined, "JSON rows the tables already wrote are not applied again");
});
