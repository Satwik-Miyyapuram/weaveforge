import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IBlobStore } from "@weaveforge/core";
import { InMemoryBlobRegistry } from "@weaveforge/core/testing";
import { TieredBlobStore } from "../providers/tiered/tiered-blob-store";

/** Minimal in-memory IBlobStore for tiered unit tests. */
class MapBlobStore implements IBlobStore {
  readonly files = new Map<string, Blob>();

  private key(bucket: string, path: string): string {
    return `${bucket}/${path}`;
  }

  async upload(bucket: string, path: string, blob: Blob): Promise<void> {
    this.files.set(this.key(bucket, path), blob);
  }

  async remove(bucket: string, path: string): Promise<void> {
    this.files.delete(this.key(bucket, path));
  }

  async signedUrls(bucket: string, paths: string[], _ttl: number): Promise<(string | null)[]> {
    return paths.map((p) => (this.files.has(this.key(bucket, p)) ? `mem://${p}` : null));
  }
}

describe("TieredBlobStore", () => {
  it("uploads to hot and registers tier hot", async () => {
    const hot = new MapBlobStore();
    const cold = new MapBlobStore();
    const registry = new InMemoryBlobRegistry();
    const store = new TieredBlobStore({ hot, cold, registry });
    await store.upload("paper-images", "u/p/a.webp", new Blob(["x"], { type: "image/webp" }));
    assert.ok(hot.files.has("paper-images/u/p/a.webp"));
    const rec = await registry.get("paper-images", "u/p/a.webp");
    assert.equal(rec?.tier, "hot");
  });

  it("signedUrls reads cold tier and records access", async () => {
    const hot = new MapBlobStore();
    const cold = new MapBlobStore();
    const registry = new InMemoryBlobRegistry();
    await cold.upload("paper-images", "u/p/old.webp", new Blob(["y"]));
    await registry.register({
      bucket: "paper-images",
      path: "u/p/old.webp",
      tier: "cold",
      sizeBytes: 1,
    });
    const store = new TieredBlobStore({ hot, cold, registry });
    const [url] = await store.signedUrls("paper-images", ["u/p/old.webp"], 60);
    assert.equal(url, "mem://u/p/old.webp");
    const rec = await registry.get("paper-images", "u/p/old.webp");
    assert.equal(rec?.accessCount, 1);
  });

  it("signedUrls returns null when path is not registered", async () => {
    const hot = new MapBlobStore();
    await hot.upload("paper-images", "u/p/a.webp", new Blob(["x"]));
    const store = new TieredBlobStore({
      hot,
      cold: new MapBlobStore(),
      registry: new InMemoryBlobRegistry(),
    });
    const [url] = await store.signedUrls("paper-images", ["u/p/a.webp"], 60);
    assert.equal(url, null);
  });
  it("removes the object before forgetting it, and forgets it only once", async () => {
    const hot = new MapBlobStore();
    const registry = new InMemoryBlobRegistry();
    const store = new TieredBlobStore({ hot, cold: new MapBlobStore(), registry });
    await store.upload("paper-images", "u/p/a.webp", new Blob(["x"]));

    await store.remove("paper-images", "u/p/a.webp");

    assert.equal(hot.files.has("paper-images/u/p/a.webp"), false);
    assert.equal(await registry.get("paper-images", "u/p/a.webp"), null);
  });

  it("keeps the registry row when the object store refuses the delete", async () => {
    /* The row is the only thing that knows the bucket and path. Dropping it
       after a failed delete leaves the bytes in the bucket with nothing able
       to find them again. */
    const hot = new MapBlobStore();
    const registry = new InMemoryBlobRegistry();
    const store = new TieredBlobStore({ hot, cold: new MapBlobStore(), registry });
    await store.upload("paper-images", "u/p/a.webp", new Blob(["x"]));
    hot.remove = async () => {
      throw new Error("network");
    };

    await assert.rejects(() => store.remove("paper-images", "u/p/a.webp"), /network/);

    const rec = await registry.get("paper-images", "u/p/a.webp");
    assert.ok(rec, "the registry row was dropped despite the failed delete");
  });

  it("removes a cold object from the cold store, not the hot one", async () => {
    const hot = new MapBlobStore();
    const cold = new MapBlobStore();
    const registry = new InMemoryBlobRegistry();
    await cold.upload("paper-images", "u/p/old.webp", new Blob(["x"]));
    await registry.register({
      bucket: "paper-images",
      path: "u/p/old.webp",
      tier: "cold",
      sizeBytes: 1,
      priority: 50,
    });
    const store = new TieredBlobStore({ hot, cold, registry });

    await store.remove("paper-images", "u/p/old.webp");

    assert.equal(cold.files.has("paper-images/u/p/old.webp"), false);
    assert.equal(await registry.get("paper-images", "u/p/old.webp"), null);
  });
});
