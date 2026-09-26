import assert from "node:assert/strict";
import test from "node:test";

import { LocalDbHost } from "../src/local-db-host";
import type { LocalClient, LocalTransaction } from "../src/local-db";

/**
 * What happens to the engine when opening it fails part-way.
 *
 * `LocalDbHost` opens PGlite once and migrates it. The failure this file is
 * about is the gap between those two: the engine is open, the migration throws,
 * and the reference to the engine used to be dropped without closing it. The
 * next query then opened a *second* engine on the same data directory while the
 * first still held it — which on a real data directory means a lock, a warm
 * cache and two Postgres instances disagreeing about who owns the files.
 *
 * A stub client rather than a real PGlite: what is being asserted is which
 * calls the host makes and in what order, which is exactly what a real engine
 * would hide behind a WASM boot. `migrate` runs for real over it, so the
 * failure arrives from the same place it does in the app.
 */

/** A client that fails the query it is told to, and counts what it was asked. */
function stub(failOn?: string) {
  const calls = { exec: 0, query: 0, close: 0 };
  const client: LocalClient = {
    async exec() {
      calls.exec += 1;
    },
    async query<T>(sql: string) {
      calls.query += 1;
      if (failOn && sql.includes(failOn)) throw new Error(`stub refused: ${failOn}`);
      return { rows: [] as T[] };
    },
    async transaction<T>(fn: (tx: LocalTransaction) => Promise<T>) {
      return fn({
        query: async <R>(sql: string) => {
          calls.query += 1;
          if (failOn && sql.includes(failOn)) throw new Error(`stub refused: ${failOn}`);
          return { rows: [] as R[] };
        },
      });
    },
    async close() {
      calls.close += 1;
    },
  };
  return { client, calls };
}

/** No migrations on disk: the stub would rather be asked than read from. */
const NO_MIGRATIONS: string[] = [];

/** The options every test shares: nowhere real, and a discard that only counts. */
const ELSEWHERE = { dataDir: () => "/nowhere/local-db", discard: async () => {} };

test("local-db-host: a failed migration closes the engine it opened", async () => {
  const opened: ReturnType<typeof stub>[] = [];
  const host = new LocalDbHost({
    open: async () => {
      // Fails on the ledger read, which is after `open()` succeeded — the exact
      // window the finding is about.
      const made = stub("weaveforge_migrations");
      opened.push(made);
      return made.client;
    },
    migrations: NO_MIGRATIONS,
    ...ELSEWHERE,
  });

  const answer = await host.query("select 1", []);
  assert.equal(answer.ok, false);
  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.calls.close, 1, "the engine that was opened must be closed");
});

test("local-db-host: a second call after a failed open leaves exactly one engine open", async () => {
  const opened: ReturnType<typeof stub>[] = [];
  const host = new LocalDbHost({
    open: async () => {
      // The first engine fails to migrate; the second is healthy.
      const made = stub(opened.length === 0 ? "weaveforge_migrations" : undefined);
      opened.push(made);
      return made.client;
    },
    migrations: NO_MIGRATIONS,
    ...ELSEWHERE,
  });

  assert.equal((await host.query("select 1", [])).ok, false);
  assert.equal((await host.query("select 1", [])).ok, true);

  assert.equal(opened.length, 2, "a retry is a fresh open, not a remembered failure");
  assert.equal(opened[0]?.calls.close, 1, "the failed engine was closed, not abandoned");
  assert.equal(opened[1]?.calls.close, 0, "the healthy engine stays open for the queries that follow");

  // And the healthy one is the one being used: asking twice reuses it rather
  // than opening a third.
  assert.equal((await host.query("select 1", [])).ok, true);
  assert.equal(opened.length, 2);

  await host.close();
  assert.equal(opened[1]?.calls.close, 1);
});

test("local-db-host: closing after a failed open does not throw", async () => {
  const host = new LocalDbHost({
    open: async () => stub("weaveforge_migrations").client,
    migrations: NO_MIGRATIONS,
    ...ELSEWHERE,
  });

  assert.equal((await host.query("select 1", [])).ok, false);
  // Quitting runs this. A close that raised here would be a quit that hangs or
  // a crash on the way out, neither of which is a useful thing to report.
  await assert.doesNotReject(() => host.close());
});

test("local-db-host: a close that races a failed open still resolves", async () => {
  const host = new LocalDbHost({
    open: async () => {
      throw new Error("no data directory");
    },
    migrations: NO_MIGRATIONS,
    ...ELSEWHERE,
  });

  const failed = host.query("select 1", []);
  await assert.doesNotReject(() => host.close());
  assert.equal((await failed).ok, false);
});

test("local-db-host: a bad query is refused before anything is opened", async () => {
  const opened: string[] = [];
  const host = new LocalDbHost({
    open: async () => {
      opened.push("opened");
      return stub().client;
    },
    migrations: NO_MIGRATIONS,
    ...ELSEWHERE,
  });

  assert.equal((await host.query("", [])).ok, false);
  assert.equal((await host.query("select 1", [{ not: "a param" }])).ok, false);
  assert.deepEqual(opened, []);
});

test("local-db-host: a failed open is reported as such, and reset moves aside", async () => {
  let discarded = 0;
  let attempts = 0;
  const host = new LocalDbHost({
    open: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Aborted(). Build with -sASSERTIONS for more info.");
      return stub().client;
    },
    migrations: NO_MIGRATIONS,
    dataDir: () => "/nowhere/local-db",
    discard: async () => {
      discarded += 1;
    },
  });

  assert.deepEqual(host.state(), { failure: null, dataDir: "/nowhere/local-db", restoredFrom: null });

  const first = await host.query("select 1", []);
  assert.equal(first.ok, false);
  // The page sees that it was the *open* that failed, not the statement.
  assert.match((first as { message: string }).message, /could not be opened.*Aborted/);
  assert.match(host.state().failure ?? "", /Aborted/);

  const reset = await host.reset();
  assert.deepEqual(reset, { ok: true, value: null });
  assert.equal(discarded, 1);
  assert.equal(host.state().failure, null);

  // The next query opens afresh, and the failure does not linger.
  const second = await host.query("select 1", []);
  assert.equal(second.ok, true);
  assert.equal(attempts, 2);
});

test("local-db-host: reset is refused while the database is healthy", async () => {
  let discarded = 0;
  const host = new LocalDbHost({
    open: async () => stub().client,
    migrations: NO_MIGRATIONS,
    dataDir: () => "/nowhere/local-db",
    discard: async () => {
      discarded += 1;
    },
  });

  // Never opened: nothing has failed, so nothing may be moved.
  assert.equal((await host.reset()).ok, false);
  await host.query("select 1", []);
  // Opened fine: same answer.
  assert.equal((await host.reset()).ok, false);
  assert.equal(discarded, 0);
});

test("local-db-host: a reset whose move fails keeps the failure for a retry", async () => {
  const host = new LocalDbHost({
    open: async () => {
      throw new Error("Aborted().");
    },
    migrations: NO_MIGRATIONS,
    dataDir: () => "/nowhere/local-db",
    discard: async () => {
      throw new Error("EACCES: permission denied");
    },
  });
  await host.query("select 1", []);
  const reset = await host.reset();
  assert.equal(reset.ok, false);
  assert.match((reset as { message: string }).message, /EACCES/);
  assert.match(host.state().failure ?? "", /Aborted/);
});

test("local-db-host: an open that fails is retried from a backup, and says so", async () => {
  const healthy = stub();
  const host = new LocalDbHost({
    open: async () => {
      throw new Error("could not locate a valid checkpoint record");
    },
    recover: async () => ({ client: healthy.client, from: "/backups/local-db-1.tar.gz" }),
    migrations: NO_MIGRATIONS,
    ...ELSEWHERE,
  });

  assert.equal((await host.query("select 1", [])).ok, true);
  assert.deepEqual(host.state(), {
    failure: null,
    // `state()` reports the *current* directory, not the option it was built
    // with: the option is a function because the answer changes when a
    // workspace folder is connected, and the page has to see the new one.
    dataDir: ELSEWHERE.dataDir(),
    restoredFrom: "/backups/local-db-1.tar.gz",
  });
});

test("local-db-host: with no backup to recover from, the open failure is the one reported", async () => {
  let asked = 0;
  const host = new LocalDbHost({
    open: async () => {
      throw new Error("no checkpoint");
    },
    recover: async () => {
      asked += 1;
      return null;
    },
    migrations: NO_MIGRATIONS,
    ...ELSEWHERE,
  });

  const answer = await host.query("select 1", []);
  assert.equal(answer.ok, false);
  assert.equal(asked, 1);
  assert.match(host.state().failure ?? "", /no checkpoint/);
  assert.equal(host.state().restoredFrom, null);
});

test("local-db-host: a snapshot is taken only after a write, and only once per change", async () => {
  const dumps: string[] = [];
  const client: LocalClient = {
    ...stub().client,
    async dumpDataDir() {
      dumps.push("dump");
      return new Blob(["bytes"]);
    },
  };
  const host = new LocalDbHost({ open: async () => client, migrations: NO_MIGRATIONS, ...ELSEWHERE });

  assert.equal(await host.snapshot(), null, "never opens the database to back it up");
  await host.query("select 1", []);
  assert.equal(await host.snapshot(), null, "a read changes nothing worth copying");
  await host.query("insert into t values (1)", []);
  assert.ok(await host.snapshot());
  assert.equal(await host.snapshot(), null, "nothing changed since");
  await host.query("  UPDATE t set x = 2", []);
  assert.ok(await host.snapshot());
  assert.equal(dumps.length, 2);
});

test("local-db-host: a client that cannot dump is simply never backed up", async () => {
  const host = new LocalDbHost({ open: async () => stub().client, migrations: NO_MIGRATIONS, ...ELSEWHERE });
  await host.query("insert into t values (1)", []);
  assert.equal(await host.snapshot(), null);
});

test("local-db-host: queries run as the account once the device is adopted", async () => {
  let account: string | null = null;
  const claims: string[] = [];
  const client: LocalClient = {
    async exec() {},
    async query<T>(sql: string) {
      return { rows: (sql.includes("from sync_state") ? [{ account_id: account }] : []) as T[] };
    },
    async transaction<T>(fn: (tx: LocalTransaction) => Promise<T>) {
      return fn({
        query: async <R>(sql: string, params?: unknown[]) => {
          if (sql.includes("request.jwt.claims")) claims.push(String(params?.[0]));
          return { rows: [] as R[] };
        },
      });
    },
    async close() {},
  };
  const host = new LocalDbHost({ open: async () => client, migrations: NO_MIGRATIONS, ...ELSEWHERE });

  await host.query("select 1 from projects", []);
  account = "00000000-0000-4000-8000-0000000acc01";
  await host.query("select sync_claim($1, $2)", [account, "local"]);
  await host.query("select 1 from projects", []);

  assert.doesNotMatch(claims[0]!, /acc01/);
  assert.match(claims.at(-1)!, /acc01/);
});
