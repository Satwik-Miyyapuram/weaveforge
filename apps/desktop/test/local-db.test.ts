import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { LOCAL_BOOTSTRAP_SQL, LOCAL_USER_ID } from "@weaveforge/core";
import { LocalDatabase, type LocalClient } from "../src/local-db";

/** A tiny schema, so this tests the machinery rather than the app's migrations. */
const MIGRATIONS = [
  {
    name: "0001_notes.sql",
    sql: `create table notes (id uuid primary key default gen_random_uuid(), owner uuid not null default auth.uid(), body text not null);
          alter table notes enable row level security;
          create policy own_notes on notes for all using (owner = auth.uid()) with check (owner = auth.uid());
          grant all on notes to authenticated;`,
  },
];

async function open(): Promise<{ db: LocalDatabase; client: PGlite }> {
  const client = await PGlite.create({ extensions: { pgcrypto } });
  return { db: new LocalDatabase(client as unknown as LocalClient), client };
}

describe("the local database", () => {
  const opened: PGlite[] = [];
  after(async () => {
    for (const client of opened) await client.close();
  });

  async function migrated() {
    const { db, client } = await open();
    opened.push(client);
    await db.migrate(LOCAL_BOOTSTRAP_SQL, MIGRATIONS);
    await db.ensureLocalUser();
    return db;
  }

  it("applies migrations once and reports what it ran", async () => {
    const { db, client } = await open();
    opened.push(client);
    assert.deepEqual(await db.migrate(LOCAL_BOOTSTRAP_SQL, MIGRATIONS), ["0001_notes.sql"]);
    assert.deepEqual(await db.migrate(LOCAL_BOOTSTRAP_SQL, MIGRATIONS), []);
  });

  it("names the migration that failed", async () => {
    const { db, client } = await open();
    opened.push(client);
    await assert.rejects(
      db.migrate(LOCAL_BOOTSTRAP_SQL, [{ name: "0001_bad.sql", sql: "select from nowhere" }]),
      /Migration 0001_bad\.sql failed/,
    );
  });

  it("writes as the local-only user when nobody is signed in", async () => {
    const db = await migrated();
    await db.query("insert into notes (body) values ($1)", ["offline"]);
    const { rows } = await db.query<{ owner: string; body: string }>("select owner, body from notes");
    assert.deepEqual(rows, [{ owner: LOCAL_USER_ID, body: "offline" }]);
  });

  it("keeps row-level security in force, so another user sees nothing", async () => {
    const db = await migrated();
    await db.query("insert into notes (body) values ($1)", ["mine"]);
    const other = "00000000-0000-4000-8000-0000000000ff";
    const { rows } = await db.query<{ body: string }>("select body from notes", [], other);
    assert.deepEqual(rows, []);
  });

  it("gives the local user a row, so foreign keys to auth.users hold", async () => {
    const client = await PGlite.create({ extensions: { pgcrypto } });
    opened.push(client);
    const db = new LocalDatabase(client as unknown as LocalClient);
    await db.migrate(LOCAL_BOOTSTRAP_SQL, MIGRATIONS);
    await db.ensureLocalUser();
    await db.ensureLocalUser();
    // Read as the owner: `auth.users` is Supabase's table, and the app role has
    // no privileges on it — which is the arrangement the real database has too.
    const { rows } = await client.query<{ id: string }>("select id from auth.users");
    assert.deepEqual(rows.map((r) => r.id), [LOCAL_USER_ID]);
  });
});
