import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { Outbox, OUTBOX_MAX_ATTEMPTS } from "../domain/parts-2";
import { SyncStateStore } from "../domain/parts-3";
import { localSqlDb, type LocalSqlDb } from "./local-sql";

/**
 * `Outbox.rebase`: why later ops on a row are moved onto the server's version.
 *
 * Local edits bump `row_version` on this device, one bump per edit. The server
 * bumps once per write it takes, and edits made while an op waits coalesce into
 * it. So after an accepted send the local counter and the server's disagree,
 * and an op queued behind the sent one still names the local counter as its
 * base. Unless it is rebased, the server reads it as stale and every later edit
 * to the row becomes a conflict nobody made.
 */

const open: LocalSqlDb[] = [];
after(async () => {
  for (const db of open) await db.close();
});

const ROW = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const ACCOUNT = "00000000-0000-4000-8000-0000000000bb";

/** A synced table with the same two triggers the app's tables carry on a device. */
async function device(): Promise<{ box: Outbox; db: LocalSqlDb }> {
  const db = await localSqlDb();
  open.push(db);
  await db.exec("create table if not exists sync_tables (table_name text primary key)");
  await db.exec("insert into sync_tables values ('notes') on conflict do nothing");
  await db.exec(
    `create table public.notes (
       id uuid primary key, title text not null,
       row_version integer not null default 0, server_seq bigint)`,
  );
  await db.exec("create sequence if not exists sync_seq as bigint");
  // The stamp from db/migrations/0119, which the device runs too.
  await db.exec(`
    create or replace function sync_stamp() returns trigger language plpgsql as $$
    begin
      if coalesce(current_setting('weaveforge.sync_applying', true), '') = 'on' then
        return new;
      end if;
      new.server_seq := nextval('sync_seq');
      new.row_version := coalesce(old.row_version, 0) + 1;
      return new;
    end;
    $$`);
  await db.exec(
    "create trigger notes_sync_stamp before insert or update on public.notes for each row execute function sync_stamp()",
  );
  await db.exec(
    "create trigger sync_record after insert or update or delete on public.notes for each row execute function sync_record()",
  );
  return { box: new Outbox(db), db };
}

/** A row this device pulled at server version `version`, before it was adopted. */
async function pulled(db: LocalSqlDb, box: Outbox, id: string, version: number): Promise<void> {
  await db.exec("insert into public.notes (id, title) values ($1, 'pulled')", [id]);
  await box.ack("notes", id, version);
}

async function edit(db: LocalSqlDb, id: string, title: string): Promise<void> {
  await db.exec("update public.notes set title = $2 where id = $1", [id, title]);
}

async function localVersion(db: LocalSqlDb, id: string): Promise<number> {
  const row = await db.queryOne<{ row_version: number }>(
    "select row_version from public.notes where id = $1",
    [id],
  );
  return row!.row_version;
}

describe("rebasing ops queued behind an accepted send", () => {
  it("moves the op behind a coalesced send onto the server's version", async () => {
    const { box, db } = await device();
    await pulled(db, box, ROW, 3);
    await new SyncStateStore(db).adopt(ACCOUNT);

    await edit(db, ROW, "a");
    await edit(db, ROW, "b"); // coalesces into the first op
    const [first] = await box.pending();
    assert.equal(first!.baseVersion, 3);
    await box.fail(first!.opId, "offline"); // tried once, so the next edit queues behind it
    await edit(db, ROW, "c");
    assert.equal(await localVersion(db, ROW), 6);
    const queued = (await box.pending())[1]!;
    assert.equal(queued.baseVersion, 5, "built on the local counter");

    // The server took the first op as one write: 3 -> 4.
    const sent = (await box.pending())[0]!;
    await box.settleSent(sent, 4);
    await box.ack("notes", ROW, 4);

    const left = await box.pending();
    assert.equal(left.length, 1);
    assert.equal(left[0]!.opId, queued.opId);
    assert.equal(left[0]!.baseVersion, 4, "guards on what the server holds");
    assert.equal(await localVersion(db, ROW), 4);
  });

  it("would send a stale base without it", async () => {
    const { box, db } = await device();
    await pulled(db, box, ROW, 3);
    await new SyncStateStore(db).adopt(ACCOUNT);
    await edit(db, ROW, "a");
    await edit(db, ROW, "b");
    const [first] = await box.pending();
    await box.fail(first!.opId, "offline");
    await edit(db, ROW, "c");

    await box.settleSent((await box.pending())[0]!, 4); // settled, never acked
    const [left] = await box.pending();
    assert.notEqual(left!.baseVersion, 4, "the server holds 4; this op would conflict");
  });

  it("keeps an edit made during the send on the server's version too", async () => {
    const { box, db } = await device();
    await pulled(db, box, ROW, 3);
    await new SyncStateStore(db).adopt(ACCOUNT);
    await edit(db, ROW, "a");
    const sent = (await box.pending())[0]!;
    await edit(db, ROW, "b"); // lands while `sent` is in flight

    await box.settleSent(sent, 4);
    await box.ack("notes", ROW, 4);

    const [left] = await box.pending();
    assert.equal(left!.op, "update");
    assert.equal(left!.baseVersion, 4);
    assert.equal(left!.payload.title, "b");
  });

  it("rebases a queued delete as well", async () => {
    const { box, db } = await device();
    await pulled(db, box, ROW, 3);
    await new SyncStateStore(db).adopt(ACCOUNT);
    await edit(db, ROW, "a");
    const [first] = await box.pending();
    await box.fail(first!.opId, "offline");
    await db.exec("delete from public.notes where id = $1", [ROW]);

    await box.settleSent((await box.pending())[0]!, 4);
    await box.ack("notes", ROW, 4);

    const [left] = await box.pending();
    assert.equal(left!.op, "delete");
    assert.equal(left!.baseVersion, 4);
  });
});

describe("what a rebase leaves alone", () => {
  it("leaves inserts based on nothing", async () => {
    const { box } = await device();
    await box.append({ table: "notes", rowId: ROW, op: "insert", payload: { title: "x" } });
    await box.rebase("notes", ROW, 9);
    assert.equal((await box.pending())[0]!.baseVersion, null);
  });

  it("leaves dead ops as they died", async () => {
    const { box } = await device();
    const dead = await box.append({ table: "notes", rowId: ROW, op: "update", baseVersion: 2 });
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i += 1) await box.fail(dead.opId, "refused");
    await box.rebase("notes", ROW, 9);
    assert.equal((await box.dead())[0]!.baseVersion, 2);
  });

  it("leaves other rows and other tables", async () => {
    const { box } = await device();
    await box.append({ table: "notes", rowId: OTHER, op: "update", baseVersion: 2 });
    await box.append({ table: "papers", rowId: ROW, op: "update", baseVersion: 2 });
    await box.rebase("notes", ROW, 9);
    assert.deepEqual(
      (await box.pending()).map((e) => e.baseVersion),
      [2, 2],
    );
  });
});
