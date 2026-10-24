import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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

  it("recovers when the connection was left in an aborted transaction", async () => {
    const { db, client } = await open();
    opened.push(client);
    await db.migrate(LOCAL_BOOTSTRAP_SQL, MIGRATIONS);
    await db.ensureLocalUser();
    // An explicit BEGIN that failed and was never rolled back. PGlite's
    // transaction() sends its own BEGIN outside its try block, so before the
    // fix every query after this failed with "current transaction is aborted".
    await assert.rejects(client.exec("begin; select 1/0;"));
    await db.query("insert into notes (body) values ($1)", ["after"]);
    const { rows } = await db.query<{ body: string }>("select body from notes");
    assert.deepEqual(rows.map((r) => r.body), ["after"]);
  });

  it("reads as the local user only when the device has never synced", async () => {
    const { db, client } = await open();
    opened.push(client);
    assert.equal(await db.deviceUser(), LOCAL_USER_ID);
  });

  it("does not fall back to the local user when the sync state cannot be read", async () => {
    // An adopted device that answered "local user" on a passing error ran every
    // query as someone who owns none of its rows, until the app restarted.
    const failing = {
      query: async () => {
        throw Object.assign(new Error("could not read block"), { code: "XX001" });
      },
      exec: async () => [],
    } as unknown as LocalClient;
    await assert.rejects(new LocalDatabase(failing).deviceUser(), /could not read block/);
  });

  it("keeps the original error when the rollback fails too", async () => {
    const failing = {
      query: async () => {
        throw Object.assign(new Error("current transaction is aborted"), { code: "25P02" });
      },
      exec: async () => {
        throw new Error("rollback failed");
      },
    } as unknown as LocalClient;
    await assert.rejects(new LocalDatabase(failing).ensureLocalUser(), /current transaction is aborted/);
  });
});


describe("migrations and their ledger (37-19)", () => {
  const opened: PGlite[] = [];
  after(async () => {
    for (const client of opened) await client.close();
  });

  async function fresh() {
    const client = await PGlite.create({ extensions: { pgcrypto } });
    opened.push(client);
    return client;
  }

  /** The client, with the ledger write for one migration failing once — a crash between the two. */
  function failingLedgerOnce(client: PGlite): LocalClient {
    let failed = false;
    return {
      exec: (sql: string) => client.exec(sql),
      query: async (sql: string, params?: unknown[]) => {
        if (!failed && /insert into weaveforge_migrations/i.test(sql)) {
          failed = true;
          throw new Error("killed before the ledger was written");
        }
        return client.query(sql, params);
      },
      transaction: (fn) => client.transaction(fn as never),
      close: () => client.close(),
    } as LocalClient;
  }

  it("a migration whose ledger write fails is not left applied, and reruns cleanly", async () => {
    const client = await fresh();
    await assert.rejects(new LocalDatabase(failingLedgerOnce(client)).migrate(LOCAL_BOOTSTRAP_SQL, MIGRATIONS));

    const tables = await client.query(`select 1 from information_schema.tables where table_name = 'notes'`);
    assert.equal(tables.rows.length, 0, "the schema change rolled back with its ledger row");
    assert.deepEqual(await new LocalDatabase(client as unknown as LocalClient).migrate(LOCAL_BOOTSTRAP_SQL, MIGRATIONS), [
      "0001_notes.sql",
    ]);
  });

  it("a migration that fails leaves no ledger row", async () => {
    const client = await fresh();
    const db = new LocalDatabase(client as unknown as LocalClient);
    await assert.rejects(
      db.migrate(LOCAL_BOOTSTRAP_SQL, [{ name: "0001_half.sql", sql: "create table half (id int); select from nowhere" }]),
      /0001_half\.sql/,
    );
    const ledger = await client.query(`select name from weaveforge_migrations`);
    assert.equal(ledger.rows.length, 0);
  });

  it("a migration with its own begin and commit is recorded once", async () => {
    const client = await fresh();
    const db = new LocalDatabase(client as unknown as LocalClient);
    const own = [{ name: "0001_own_tx.sql", sql: "begin;\ncreate table own (id int);\ncommit;\n" }];
    assert.deepEqual(await db.migrate(LOCAL_BOOTSTRAP_SQL, own), ["0001_own_tx.sql"]);
    assert.deepEqual(await db.migrate(LOCAL_BOOTSTRAP_SQL, own), []);
  });

  it("replays every shipped migration, 0099 included, and records each once", async () => {
    const root = path.resolve(import.meta.dirname, "../../../db");
    const migrations = ["migrations", "migrations-local"].flatMap((dir) =>
      readdirSync(path.join(root, dir))
        .filter((name) => name.endsWith(".sql"))
        .sort()
        .map((name) => ({ name: `${dir}/${name}`, sql: readFileSync(path.join(root, dir, name), "utf8") })),
    );
    assert.ok(migrations.some((m) => m.name.startsWith("migrations/0099_")));

    const client = await fresh();
    const db = new LocalDatabase(client as unknown as LocalClient);
    assert.deepEqual(await db.migrate(LOCAL_BOOTSTRAP_SQL, migrations), migrations.map((m) => m.name));
    assert.deepEqual(await db.migrate(LOCAL_BOOTSTRAP_SQL, migrations), []);
    const ledger = await client.query<{ n: number }>(`select count(*)::int as n from weaveforge_migrations`);
    assert.equal(ledger.rows[0]!.n, migrations.length);
  });
});
