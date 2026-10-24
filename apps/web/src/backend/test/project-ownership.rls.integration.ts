import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { testDb, type TestDb } from "./pg-test-db";

/**
 * Project-scoped tables must check that the caller owns the project (and the
 * paper) a row points at, not only the row's `user_id`.
 *
 * A foreign key ignores RLS, so a policy that checks only `user_id` lets a
 * stranger insert a row naming somebody else's project. With the tables'
 * unique keys, that row then blocks the owner from creating their own
 * (squatting). Review rows 39-04 and 40-05; 0106 has the correct pattern.
 *
 * Projects cannot be shared (`resource_owner` has no 'project' type), so
 * "owns the project" is the whole rule. A paper may also sit outside any
 * project (library paper), which stays allowed.
 */

const RLS = /row-level security/i;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const sqlFile = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

interface World {
  db: TestDb;
  owner: string;
  stranger: string;
  ownerProject: string;
  ownerPaper: string;
  /** The owner's paper in a second project of theirs. */
  ownerOtherPaper: string;
  /** The owner's paper outside any project. */
  ownerLibraryPaper: string;
  strangerProject: string;
  strangerPaper: string;
}

async function world(): Promise<World> {
  const db = await testDb();
  const owner = await db.createUser();
  const stranger = await db.createUser();
  const project = async (who: string) =>
    (await db.as(who).sql<{ id: string }>(
      "insert into projects (name) values ('ownership') returning id",
    ))[0]!.id;
  const paper = async (who: string, projectId: string | null) =>
    (await db.as(who).sql<{ id: string }>(
      "insert into papers (user_id, project_id, title) values ($1, $2, 'p') returning id",
      [who, projectId],
    ))[0]!.id;

  const ownerProject = await project(owner);
  const ownerOther = await project(owner);
  const strangerProject = await project(stranger);
  return {
    db,
    owner,
    stranger,
    ownerProject,
    ownerPaper: await paper(owner, ownerProject),
    ownerOtherPaper: await paper(owner, ownerOther),
    ownerLibraryPaper: await paper(owner, null),
    strangerProject,
    strangerPaper: await paper(stranger, strangerProject),
  };
}

interface Spec {
  table: string;
  /** False for tables without a paper_id column. */
  hasPaper: boolean;
  /** Insert one row as `who`; `key` keeps unique keys apart between calls. */
  insert: (w: World, who: string, project: string, paper: string, key: string) => Promise<{ id: string }[]>;
}

/** Owner-side helper rows (RLS bypassed): they are not under test here. */
const ownRow = async (w: World, sql: string, params: unknown[]) =>
  (await w.db.sql<{ id: string }>(sql, params))[0]!.id;

const SPECS: Spec[] = [
  {
    table: "citation_alert_tracks",
    hasPaper: true,
    insert: (w, who, project, paper) =>
      w.db.as(who).sql(
        "insert into citation_alert_tracks (user_id, project_id, paper_id) values ($1, $2, $3) returning id",
        [who, project, paper],
      ),
  },
  {
    table: "annotation_pins",
    hasPaper: true,
    insert: async (w, who, project, paper, key) => {
      const section = await ownRow(
        w,
        "insert into report_sections (user_id, project_id, title) values ($1, $2, 's') returning id",
        [who, who === w.owner ? w.ownerProject : w.strangerProject],
      );
      return w.db.as(who).sql(
        `insert into annotation_pins (user_id, project_id, paper_id, annotation_key, report_section_id)
         values ($1, $2, $3, $4, $5) returning id`,
        [who, project, paper, key, section],
      );
    },
  },
  {
    table: "paper_field_defs",
    hasPaper: false,
    insert: (w, who, project, _paper, key) =>
      w.db.as(who).sql(
        "insert into paper_field_defs (user_id, project_id, name, kind) values ($1, $2, $3, 'text') returning id",
        [who, project, key],
      ),
  },
  {
    table: "paper_field_values",
    hasPaper: true,
    insert: async (w, who, project, paper, key) => {
      const field = await ownRow(
        w,
        "insert into paper_field_defs (user_id, project_id, name, kind) values ($1, $2, $3, 'text') returning id",
        [who, who === w.owner ? w.ownerProject : w.strangerProject, `field-${key}-${crypto.randomUUID()}`],
      );
      return w.db.as(who).sql(
        `insert into paper_field_values (user_id, project_id, paper_id, field_id, value)
         values ($1, $2, $3, $4, '"v"') returning id`,
        [who, project, paper, field],
      );
    },
  },
  {
    table: "annotation_quotation_types",
    hasPaper: true,
    insert: (w, who, project, paper, key) =>
      w.db.as(who).sql(
        `insert into annotation_quotation_types (user_id, project_id, paper_id, annotation_key, quotation_type)
         values ($1, $2, $3, $4, 'direct') returning id`,
        [who, project, paper, key],
      ),
  },
  {
    table: "reader_annotations",
    hasPaper: true,
    insert: (w, who, project, paper, key) =>
      w.db.as(who).sql(
        `insert into reader_annotations (user_id, project_id, paper_id, zotero_key, type, anchor, page_index)
         values ($1, $2, $3, $4, 'highlight', '{}', 0) returning id`,
        [who, project, paper, key],
      ),
  },
  {
    table: "overleaf_linked_reports",
    hasPaper: false,
    insert: async (w, who, project, _paper, key) => {
      const connection = await ownRow(
        w,
        "insert into overleaf_connections (user_id, name, token_ciphertext) values ($1, 'c', 'x') returning id",
        [who],
      );
      return w.db.as(who).sql(
        `insert into overleaf_linked_reports (user_id, project_id, connection_id, title, overleaf_project_id)
         values ($1, $2, $3, 't', $4) returning id`,
        [who, project, connection, key],
      );
    },
  },
];

for (const spec of SPECS) {
  describe(`${spec.table} checks project ownership`, () => {
    it("refuses a stranger's row in the owner's project, so the owner's key stays free", async () => {
      const w = await world();
      await assert.rejects(spec.insert(w, w.stranger, w.ownerProject, w.ownerPaper, "squat"), RLS);
      const [row] = await spec.insert(w, w.owner, w.ownerProject, w.ownerPaper, "squat");
      assert.ok(row?.id, "the owner creates the row the stranger tried to take");
    });

    it("still lets each user write in their own project", async () => {
      const w = await world();
      assert.equal((await spec.insert(w, w.owner, w.ownerProject, w.ownerPaper, "own")).length, 1);
      assert.equal((await spec.insert(w, w.stranger, w.strangerProject, w.strangerPaper, "own")).length, 1);
    });

    if (spec.hasPaper) {
      it("refuses the owner's paper under a stranger's own project", async () => {
        const w = await world();
        await assert.rejects(spec.insert(w, w.stranger, w.strangerProject, w.ownerPaper, "mix"), RLS);
      });

      it("refuses a paper from another project, allows a library paper", async () => {
        const w = await world();
        await assert.rejects(spec.insert(w, w.owner, w.ownerProject, w.ownerOtherPaper, "other"), RLS);
        assert.equal((await spec.insert(w, w.owner, w.ownerProject, w.ownerLibraryPaper, "lib")).length, 1);
      });
    }

    it("refuses moving a stranger's own row into the owner's project", async () => {
      const w = await world();
      const [mine] = await spec.insert(w, w.stranger, w.strangerProject, w.strangerPaper, "move");
      const set = spec.hasPaper ? "project_id = $1, paper_id = $2" : "project_id = $1";
      const params = spec.hasPaper ? [w.ownerProject, w.ownerPaper, mine!.id] : [w.ownerProject, mine!.id];
      await assert.rejects(
        w.db.as(w.stranger).sql(`update ${spec.table} set ${set} where id = $${params.length}`, params),
        RLS,
      );
    });

    it("hides the owner's row from a stranger for read, update and delete", async () => {
      const w = await world();
      const [theirs] = await spec.insert(w, w.owner, w.ownerProject, w.ownerPaper, "hidden");
      const as = w.db.as(w.stranger);
      assert.equal((await as.sql(`select id from ${spec.table} where id = $1`, [theirs!.id])).length, 0);
      assert.equal(
        (await as.sql(`update ${spec.table} set user_id = user_id where id = $1 returning id`, [theirs!.id])).length,
        0,
      );
      assert.equal((await as.sql(`delete from ${spec.table} where id = $1 returning id`, [theirs!.id])).length, 0);
      assert.equal((await w.db.sql(`select id from ${spec.table} where id = $1`, [theirs!.id])).length, 1);
    });
  });
}

// Last: it swaps the policies of the shared test database, then puts 0142 back.
describe("0142 rollback", () => {
  it("restores the user-only policies, and 0142 re-applies cleanly", async () => {
    const w = await world();
    const squat = (key: string) =>
      w.db.as(w.stranger).sql(
        "insert into reader_annotations (user_id, project_id, paper_id, zotero_key, type, anchor, page_index) values ($1, $2, $3, $4, 'highlight', '{}', 0) returning id",
        [w.stranger, w.ownerProject, w.ownerPaper, key],
      );

    await w.db.exec(sqlFile("db/migrations-rollback/0142_project_ownership_policies.sql"));
    assert.equal((await squat("rolled-back")).length, 1, "the rollback lets a foreign project through again");

    await w.db.exec(sqlFile("db/migrations/0142_project_ownership_policies.sql"));
    await assert.rejects(squat("re-applied"), RLS);
  });
});
