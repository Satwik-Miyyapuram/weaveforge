import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { testDb } from "./pg-test-db";

/**
 * Screening decisions, against the real migrations.
 *
 * The policies here carry a rule the rest of the schema does not: the owner of
 * a list is not privileged over a collaborator's judgement. A screen exists to
 * be done twice independently, so "the owner can edit everything in their own
 * list" -- true of every other table -- would quietly defeat the feature.
 */
async function sharedList(): Promise<{
  db: Awaited<ReturnType<typeof testDb>>;
  owner: string;
  reviewer: string;
  itemId: string;
}> {
  const db = await testDb();
  const owner = await db.createUser();
  const reviewer = await db.createUser();

  const [list] = await db.as(owner).sql<{ id: string }>(
    "insert into reading_lists (user_id, name) values ($1, $2) returning id",
    [owner, "screen"],
  );
  const [paper] = await db.as(owner).sql<{ id: string }>(
    "insert into papers (user_id, title) values ($1, $2) returning id",
    [owner, "A candidate"],
  );
  const [item] = await db.as(owner).sql<{ id: string }>(
    "insert into reading_list_items (list_id, paper_id) values ($1, $2) returning id",
    [list!.id, paper!.id],
  );
  await db.as(owner).sql(
    `insert into shares (owner_id, recipient_id, resource_type, resource_id)
     values ($1, $2, 'reading_list', $3)`,
    [owner, reviewer, list!.id],
  );
  return { db, owner, reviewer, itemId: item!.id };
}

/** A one-item list owned by `who`, shared with nobody. */
async function listOf(db: Awaited<ReturnType<typeof testDb>>, who: string): Promise<{ itemId: string }> {
  const [list] = await db.as(who).sql<{ id: string }>(
    "insert into reading_lists (user_id, name) values ($1, 'private') returning id", [who],
  );
  const [paper] = await db.as(who).sql<{ id: string }>(
    "insert into papers (user_id, title) values ($1, 'Hidden') returning id", [who],
  );
  const [item] = await db.as(who).sql<{ id: string }>(
    "insert into reading_list_items (list_id, paper_id) values ($1, $2) returning id", [list!.id, paper!.id],
  );
  return { itemId: item!.id };
}

const record = (
  db: Awaited<ReturnType<typeof testDb>>,
  who: string,
  itemId: string,
  state: string,
  stage = "title_abstract",
) =>
  db.as(who).sql<{ id: string }>(
    "insert into screening_decisions (item_id, reviewer_id, stage, state) values ($1, $2, $3, $4) returning id",
    [itemId, who, stage, state],
  );

describe("screening decisions", () => {
  it("lets two reviewers disagree, each holding their own row", async () => {
    const { db, owner, reviewer, itemId } = await sharedList();
    await record(db, owner, itemId, "included");
    await record(db, reviewer, itemId, "excluded");

    const seen = await db.as(reviewer).sql<{ state: string }>(
      "select state from screening_decisions where item_id = $1 order by state",
      [itemId],
    );
    assert.deepEqual(
      seen.map((row) => row.state),
      ["excluded", "included"],
    );
  });

  it("refuses a second decision on the same item at the same stage", async () => {
    const { db, owner, itemId } = await sharedList();
    await record(db, owner, itemId, "included");
    await assert.rejects(record(db, owner, itemId, "excluded"), /duplicate key|unique/i);
  });

  it("refuses a decision recorded in somebody else's name", async () => {
    const { db, owner, reviewer, itemId } = await sharedList();
    await assert.rejects(
      db.as(owner).sql(
        "insert into screening_decisions (item_id, reviewer_id, state) values ($1, $2, 'included')",
        [itemId, reviewer],
      ),
      /row-level security/i,
    );
  });

  it("does not let the list's owner overwrite a collaborator's decision", async () => {
    const { db, owner, reviewer, itemId } = await sharedList();
    const [theirs] = await record(db, reviewer, itemId, "excluded");
    const changed = await db.as(owner).sql(
      "update screening_decisions set state = 'included' where id = $1 returning id",
      [theirs!.id],
    );
    // The policy filters the row out rather than raising: the owner's update
    // matches nothing, which is the outcome that matters.
    assert.deepEqual(changed, []);
  });

  it("hides decisions on a list nobody shared with you", async () => {
    const { db, owner, itemId } = await sharedList();
    await record(db, owner, itemId, "included");
    const stranger = await db.createUser();
    const seen = await db
      .as(stranger)
      .sql("select id from screening_decisions where item_id = $1", [itemId]);
    assert.deepEqual(seen, []);
  });

  // Review row 40-06: update and delete checked only reviewer_id. A filtered
  // statement (`where id = ...`) is already caught by the select policy, which
  // Postgres applies whenever the statement reads a column. An unfiltered one,
  // which PostgREST will send, is not; these cases use that shape.
  it("refuses moving a decision onto an item the reviewer cannot see", async () => {
    const { db, reviewer, itemId } = await sharedList();
    const [mine] = await record(db, reviewer, itemId, "included");
    const stranger = await db.createUser();
    const { itemId: hiddenItem } = await listOf(db, stranger);
    await assert.rejects(
      db.as(reviewer).sql("update screening_decisions set item_id = $1", [hiddenItem]),
      /row-level security/i,
    );
    const [kept] = await db.sql<{ item_id: string }>("select item_id from screening_decisions where id = $1", [mine!.id]);
    assert.equal(kept?.item_id, itemId);
  });

  it("lets a reviewer change their decision and move it to another visible item", async () => {
    const { db, owner, reviewer, itemId } = await sharedList();
    const [mine] = await record(db, reviewer, itemId, "included");
    const [changed] = await db.as(reviewer).sql<{ state: string }>(
      "update screening_decisions set state = 'unsure' where id = $1 returning state",
      [mine!.id],
    );
    assert.equal(changed?.state, "unsure");

    const [list] = await db.as(owner).sql<{ list_id: string }>(
      "select list_id from reading_list_items where id = $1", [itemId],
    );
    const [paper] = await db.as(owner).sql<{ id: string }>(
      "insert into papers (user_id, title) values ($1, 'Second') returning id", [owner],
    );
    const [second] = await db.as(owner).sql<{ id: string }>(
      "insert into reading_list_items (list_id, paper_id) values ($1, $2) returning id",
      [list!.list_id, paper!.id],
    );
    const moved = await db.as(reviewer).sql(
      "update screening_decisions set item_id = $1 where id = $2 returning id", [second!.id, mine!.id],
    );
    assert.equal(moved.length, 1);
  });

  it("stops update and delete once the list is unshared", async () => {
    const { db, owner, reviewer, itemId } = await sharedList();
    const [mine] = await record(db, reviewer, itemId, "included");
    await db.as(owner).sql("delete from shares where recipient_id = $1", [reviewer]);

    const as = db.as(reviewer);
    assert.deepEqual(
      await as.sql("update screening_decisions set state = 'excluded'"),
      [],
    );
    assert.deepEqual(await as.sql("delete from screening_decisions"), []);
    const [kept] = await db.sql<{ state: string }>("select state from screening_decisions where id = $1", [mine!.id]);
    assert.equal(kept?.state, "included", "the owner's screen keeps the decision");
  });

  it("refuses a state that is not one of the three", async () => {
    const { db, owner, itemId } = await sharedList();
    await assert.rejects(record(db, owner, itemId, "maybe-later"), /check constraint/i);
  });

  it("carries the decisions in the change feed, so a screen survives being offline", async () => {
    const { db, owner, itemId } = await sharedList();
    await record(db, owner, itemId, "included");
    const rows = await db.as(owner).sql<{ table_name: string }>(
      "select table_name from sync_changes(0, 5000) where table_name = 'screening_decisions'",
    );
    assert.equal(rows.length, 1);
  });
});
