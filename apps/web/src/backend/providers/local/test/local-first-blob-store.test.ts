import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { BlobNotFoundError, type IBlobStore } from "@weaveforge/core";

import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import { keepFlushing, LocalFirstBlobStore } from "../local-first-blob-store";
import type { LocalQuery } from "../pglite-client";

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../../db/migrations-local");

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

  it("says a blob stored nowhere is not found, and an unreachable server is not", async () => {
    await assert.rejects(store.fetchBytes("vault-assets", "u/n/ink/none.inkb"), BlobNotFoundError);
    server.up = false;
    await assert.rejects(store.fetchBytes("vault-assets", "u/n/ink/none.inkb"), (err: unknown) =>
      err instanceof Error && !(err instanceof BlobNotFoundError) && /offline/.test(err.message));
  });
  it("keeps a queued upload when this computer's copy cannot be read (09-07)", async () => {
    online = false;
    await store.upload("paper-images", "u/p/a.png", png());
    let readsFail = true;
    const flaky: LocalQuery = async (sql, params) => {
      if (readsFail && /from local_blobs/.test(sql)) throw new Error("disk busy");
      return run(sql, params);
    };
    const s2 = new LocalFirstBlobStore(flaky, server, () => true);
    await s2.flush();
    assert.equal(await s2.pending(), 1);
    assert.equal(server.stored.size, 0);
    readsFail = false;
    await s2.flush();
    assert.equal(await s2.pending(), 0);
    assert.equal(server.stored.size, 1);
  });

  it("drops a queued upload whose local copy is gone (09-07)", async () => {
    online = false;
    await store.upload("paper-images", "u/p/a.png", png());
    await run("delete from local_blobs", []);
    online = true;
    await store.flush();
    assert.equal(await store.pending(), 0);
    assert.equal(server.stored.size, 0);
  });

  it("logs a server read it falls back from (09-16)", async () => {
    server.up = false;
    await withAppLogs(async (logs) => {
      assert.deepEqual(await store.signedUrls("paper-images", ["u/p/x.png"], 60), [null]);
      assert.equal((await store.fetchBlobs("paper-images", ["u/p/x.png"])).size, 0);
      assert.equal(logs.length, 2);
      for (const log of logs) {
        assert.equal(log.level, "warn");
        assert.match(log.detail ?? "", /paper-images.*offline/);
      }
    });
  });

  it("logs nothing when the server is not asked (09-16)", async () => {
    await store.upload("paper-images", "u/p/a.png", png(), "image/png");
    await withAppLogs(async (logs) => {
      await store.signedUrls("paper-images", ["u/p/a.png"], 60);
      await store.fetchBlobs("paper-images", ["u/p/a.png"]);
      assert.equal(logs.length, 0);
    });
  });

  it("logs a send loop that fails instead of dropping it (09-19)", async () => {
    const broken = new LocalFirstBlobStore(async (sql, params) => {
      if (sql.includes("order by queued_at")) throw new Error("database closed");
      return run(sql, params);
    }, server);
    await withAppLogs(async (logs) => {
      await broken.upload("paper-images", "u/p/a.png", png(), "image/png");
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(logs.length, 1);
      assert.match(logs[0]!.detail ?? "", /database closed/);
    });
  });

  it("logs a timed retry that fails (09-19)", async () => {
    const g = globalThis as { window?: unknown };
    g.window = { addEventListener() {}, removeEventListener() {}, setInterval: () => 0, clearInterval() {} };
    try {
      const failing = { flush: () => Promise.reject(new Error("database closed")) } as unknown as LocalFirstBlobStore;
      await withAppLogs(async (logs) => {
        keepFlushing(failing)();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(logs.length, 1);
        assert.match(logs[0]!.detail ?? "", /database closed/);
      });
    } finally {
      delete g.window;
    }
  });
});
