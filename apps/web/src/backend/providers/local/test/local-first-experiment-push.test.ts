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
  let fail = false;
  const client = {
    from: (table: string) => ({
      insert: async (rows: Record<string, unknown>[]) => {
        if (fail) return { error: { message: "offline" } };
        inserted.push(...rows);
        return { error: null };
      },
      delete: () => ({
        eq: async (_: string, id: string) => {
          deleted.push(`${table} ${id}`);
          return { error: null };
        },
      }),
    }),
  };
  return { client: client as unknown as SupabaseClient, inserted, deleted, setFail: (f: boolean) => (fail = f) };
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
    create table experiments (id uuid primary key, artifacts jsonb);
    create table experiment_metrics (experiment_id uuid, metric text, step int, value float8, wall_time timestamptz);
  `);
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
    push = new ExperimentPush(run, server.client, store, "acct", async () => new Blob(["png"], { type: "image/png" }));
  });

  it("sends each metric point once, as the signed-in account", async () => {
    await run("insert into experiment_metrics values ($1, 'loss', 0, 1.5, null), ($1, 'loss', 1, 1.2, null)", [EXP]);
    await push.push();
    await push.push();
    assert.equal(server.inserted.length, 2);
    assert.equal(server.inserted[0]!.user_id, "acct");
    await run("insert into experiment_metrics values ($1, 'loss', 2, 1.0, null)", [EXP]);
    await push.push();
    assert.deepEqual(server.inserted.map((r) => r.step), [0, 1, 2]);
  });

  it("tries again later when the server refuses", async () => {
    await run("insert into experiment_metrics values ($1, 'loss', 0, 1.5, null)", [EXP]);
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
  });
});
