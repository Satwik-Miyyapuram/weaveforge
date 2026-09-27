import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { IBlobStore } from "@weaveforge/core";

import { LocalFirstBlobStore } from "../local-first-blob-store";
import type { LocalQuery } from "../pglite-client";

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../../supabase/migrations-local");

/** A server that can be switched off, and says what reached it. */
class FakeServer implements IBlobStore {
  up = true;
  stored = new Map<string, Blob>();
  calls: string[] = [];

  async upload(bucket: string, p: string, blob: Blob): Promise<void> {
    this.calls.push(`upload ${p}`);
    if (!this.up) throw new Error("offline");
    this.stored.set(`${bucket}/${p}`, blob);
  }

  async remove(bucket: string, p: string): Promise<void> {
    this.calls.push(`remove ${p}`);
    if (!this.up) throw new Error("offline");
    this.stored.delete(`${bucket}/${p}`);
  }

  async signedUrls(bucket: string, paths: string[]): Promise<(string | null)[]> {
    if (!this.up) throw new Error("offline");
    return paths.map((p) => (this.stored.has(`${bucket}/${p}`) ? `https://server/${p}` : null));
  }
}

async function database(): Promise<LocalQuery> {
  const pg = new PGlite();
  for (const file of ["0006_local_blobs.sql", "0009_local_blob_uploads.sql"]) {
    await pg.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
  return async (sql, params) => (await pg.query(sql, params as unknown[])).rows;
}

const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

describe("the local-first blob store", () => {
  let run: LocalQuery;
  let server: FakeServer;
  let online: boolean;
  let store: LocalFirstBlobStore;

  beforeEach(async () => {
    run = await database();
    server = new FakeServer();
    online = true;
    store = new LocalFirstBlobStore(run, server, () => online);
  });

  it("keeps a picture with no network and shows it straight away", async () => {
    online = false;
    server.up = false;
    await store.upload("paper-images", "u/p/a.png", png(), "image/png");
    const blob = await store.fetchBlob("paper-images", "u/p/a.png");
    assert.equal(blob.type, "image/png");
    assert.equal(blob.size, 4);
    const [url] = await store.signedUrls("paper-images", ["u/p/a.png"], 60);
    assert.match(url ?? "", /^data:image\/png;base64,/);
    assert.equal(await store.pending(), 1);
    assert.deepEqual(server.calls, []);
  });

  it("sends the queue once the network is back", async () => {
    online = false;
    await store.upload("paper-images", "u/p/a.png", png());
    online = true;
    await store.flush();
    assert.ok(server.stored.has("paper-images/u/p/a.png"));
    assert.equal(await store.pending(), 0);
  });

  it("keeps a failed send queued with its reason, and retries it", async () => {
    server.up = false;
    await store.upload("paper-images", "u/p/a.png", png());
    await store.flush();
    const [row] = (await run("select attempts, last_error from local_blob_uploads", [])) as {
      attempts: number;
      last_error: string;
    }[];
    assert.ok((row?.attempts ?? 0) >= 1);
    assert.equal(row?.last_error, "offline");
    server.up = true;
    await store.flush();
    assert.equal(await store.pending(), 0);
  });

  it("never sends a picture removed before it reached the server", async () => {
    online = false;
    await store.upload("paper-images", "u/p/a.png", png());
    await store.remove("paper-images", "u/p/a.png");
    online = true;
    await store.flush();
    assert.equal(await store.pending(), 0);
    assert.deepEqual(server.calls, []);
  });

  it("removes from the server what the server already had", async () => {
    await store.upload("paper-images", "u/p/a.png", png());
    await store.flush();
    await store.remove("paper-images", "u/p/a.png");
    await store.flush();
    assert.equal(server.stored.size, 0);
  });

  it("asks the server only for what this computer does not have", async () => {
    server.stored.set("paper-images/u/p/b.png", png());
    await store.upload("paper-images", "u/p/a.png", png());
    const urls = await store.signedUrls("paper-images", ["u/p/a.png", "u/p/b.png", "u/p/c.png"], 60);
    assert.match(urls[0] ?? "", /^data:/);
    assert.equal(urls[1], "https://server/u/p/b.png");
    assert.equal(urls[2], null);
  });

  it("answers from this computer when the server is unreachable", async () => {
    await store.upload("paper-images", "u/p/a.png", png());
    server.up = false;
    const urls = await store.signedUrls("paper-images", ["u/p/a.png", "u/p/b.png"], 60);
    assert.match(urls[0] ?? "", /^data:/);
    assert.equal(urls[1], null);
    assert.equal((await store.fetchBlobs("paper-images", ["u/p/a.png", "u/p/b.png"])).size, 1);
  });
});
