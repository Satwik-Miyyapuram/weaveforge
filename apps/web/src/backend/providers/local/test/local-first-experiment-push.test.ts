import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IBlobStore } from "@weaveforge/core";

import { LocalFirstBlobStore } from "../local-first-blob-store";
import { ExperimentPush } from "../local-first-experiment-push";
import type { LocalQuery } from "../pglite-client";

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../../supabase/migrations-local");
const EXP = "11111111-1111-1111-1111-111111111111";

/** The bits of a PostgREST client the push uses, remembering what it was sent. */
function fakeServer() {
  const inserted: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  const rows = new Map<string, unknown>();
  let fail = false;
  const client = {
    from: (table: string) => ({
      insert: async (rows: Record<string, unknown>[]) => {
        if (fail) return { error: { message: "offline" } };
        inserted.push(...rows);
        return { error: null };
      },
      select: () => ({
        in: async (_: string, ids: string[]) => ({
          data: ids.filter((id) => rows.has(id)).map((id) => ({ id, artifacts: rows.get(id) })),
          error: null,
        }),
      }),
      update: (patch: { artifacts: unknown }) => ({
        eq: async (_: string, id: string) => {
          rows.set(id, patch.artifacts);
          return { error: null };
        },
      }),
      delete: () => {
        const keys: unknown[] = [];
        const chain = {
          eq: (_: string, v: unknown) => {
            keys.push(v);
            return chain;
          },
          then: (done: (r: { error: null }) => void) => {
            deleted.push(`${table} ${keys.join(" ")}`);
            done({ error: null });
          },
        };
        return chain;
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, inserted, deleted, rows, setFail: (f: boolean) => (fail = f) };
}

class Blobs implements IBlobStore {
  stored = new Set<string>();
  async upload(bucket: string, p: string): Promise<void> {
    this.stored.add(`${bucket}/${p}`);
  }
  async remove(): Promise<void> {}
  async signedUrls(_: string, paths: string[]): Promise<(string | null)[]> {
    return paths.map(() => null);
  }
}

async function database(): Promise<LocalQuery> {
  const pg = new PGlite();
  for (const file of ["0006_local_blobs.sql", "0009_local_blob_uploads.sql", "0013_local_metric_pushes.sql"]) {
    await pg.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
  await pg.exec(`
    create table experiments (id uuid primary key, artifacts jsonb, user_id uuid);
    create table experiment_metric_names (id serial primary key, name text unique);
    create table experiment_metric_points (experiment_id uuid, metric_id int, step int, value float8, wall_time timestamptz,
      user_id uuid, primary key (experiment_id, metric_id, step));
    create table experiment_metric_chunks (experiment_id uuid, user_id uuid);
    insert into experiment_metric_names (name) values ('loss');
  `);
  await pg.exec(readFileSync(path.join(MIGRATIONS, "0014_metric_push_queue.sql"), "utf8"));
  return async (sql, params) => (await pg.query(sql, params as unknown[])).rows;
}

describe("pushing desktop runs to the server", () => {
  let run: LocalQuery;
  let server: ReturnType<typeof fakeServer>;
  let blobs: Blobs;
  let push: ExperimentPush;

  beforeEach(async () => {
    run = await database();
    server = fakeServer();
    blobs = new Blobs();
    const store = new LocalFirstBlobStore(run, blobs, () => true);
    push = new ExperimentPush(run, server.client, store, "acct", async () => new Blob(["png"], { type: "image/png" }), async (b) => b);
  });

  it("sends each metric point once, as the signed-in account", async () => {
    await run("insert into experiment_metric_points values ($1, 1, 0, 1.5, null), ($1, 1, 1, 1.2, null)", [EXP]);
    await push.push();
    await push.push();
    assert.equal(server.inserted.length, 2);
    assert.equal(server.inserted[0]!.user_id, "acct");
    await run("insert into experiment_metric_points values ($1, 1, 2, 1.0, null)", [EXP]);
    await push.push();
    assert.deepEqual(server.inserted.map((r) => r.step), [0, 1, 2]);
  });

  it("thins long runs for the server and keeps every point here", async () => {
    await run("insert into experiment_metric_points select $1, 1, g, g, null from generate_series(0, 39999) g", [EXP]);
    await push.push();
    const steps = server.inserted.map((r) => r.step as number);
    assert.equal(steps.length - server.deleted.length, 20001);
    assert.ok(steps.includes(39999));
    assert.equal(((await run("select count(*)::int as n from experiment_metric_points", [])) as { n: number }[])[0]!.n, 40000);
    assert.equal((await run("select * from local_metric_dirty", [])).length, 0);
  });

  it("tries again later when the server refuses", async () => {
    await run("insert into experiment_metric_points values ($1, 1, 0, 1.5, null)", [EXP]);
    server.setFail(true);
    await assert.rejects(push.push());
    server.setFail(false);
    await push.push();
    assert.equal(server.inserted.length, 1);
  });

  it("clears the server copy of a reset run first", async () => {
    await run("insert into local_metric_resets (experiment_id) values ($1)", [EXP]);
    await push.push();
    assert.deepEqual(server.deleted, [`experiment_metric_points ${EXP}`, `experiment_metric_chunks ${EXP}`]);
    assert.equal((await run("select * from local_metric_resets", [])).length, 0);
  });

  it("turns app:// artifacts into storage paths", async () => {
    await run("insert into experiments values ($1, $2::jsonb)", [EXP, JSON.stringify([`app://artifacts/${EXP}/u1/a.png`, "keep"])]);
    await push.push();
    const [row] = (await run("select artifacts from experiments", [])) as { artifacts: string[] }[];
    assert.deepEqual(row!.artifacts, [`acct/${EXP}/u1/a.png`, "keep"]);
    assert.ok(blobs.stored.has(`experiment-artifacts/acct/${EXP}/u1/a.png`));
    assert.deepEqual(server.rows.get(EXP), [`acct/${EXP}/u1/a.png`, "keep"]);
  });

  it("sends png/jpg up as webp and keeps svg as it is", async () => {
    const webp = async (b: Blob) => (b.type === "image/png" ? new Blob(["w"], { type: "image/webp" }) : b);
    const files: Record<string, Blob> = {
      a: new Blob(["png"], { type: "image/png" }),
      b: new Blob(["<svg/>"], { type: "image/svg+xml" }),
    };
    push = new ExperimentPush(run, server.client, new LocalFirstBlobStore(run, blobs, () => true), "acct",
      async (u) => files[u.endsWith(".png") ? "a" : "b"]!, webp);
    await run("insert into experiments values ($1, $2::jsonb)", [EXP, JSON.stringify([`app://artifacts/${EXP}/u1/a.png`, `app://artifacts/${EXP}/u2/b.svg`])]);
    await push.push();
    assert.deepEqual(server.rows.get(EXP), [`acct/${EXP}/u1/a.webp`, `acct/${EXP}/u2/b.svg`]);
  });

  it("sends up paths an older build rewrote only here", async () => {
    await run("insert into experiments values ($1, $2::jsonb)", [EXP, JSON.stringify([`acct/${EXP}/u1/a.png`])]);
    server.rows.set(EXP, [`app://artifacts/${EXP}/u1/a.png`]);
    await push.push();
    assert.deepEqual(server.rows.get(EXP), [`acct/${EXP}/u1/a.png`]);
  });
});
