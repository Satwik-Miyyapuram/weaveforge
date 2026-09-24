/**
 * `InkFacade.assets`: the host hands `assets.fetchBlob` to hooks as a bare
 * function, so the getter must return methods that still know their store.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { InkFacade } from "../facades/ink";

class Store {
  private readonly blobs = new Map([["p/a.png", new Blob(["x"])]]);
  async upload(): Promise<string> {
    return "p/a.png";
  }
  async fetchBlob(path: string): Promise<Blob> {
    const blob = this.blobs.get(path);
    if (!blob) throw new Error(`missing ${path}`);
    return blob;
  }
}

test("ink facade: assets methods survive being passed around unbound", async () => {
  const facade = new InkFacade({
    chunks: {} as never,
    assets: new Store(),
    bridge: () => null,
    vocabulary: async () => [],
  });
  const { fetchBlob, upload } = facade.assets;
  assert.equal(await (await fetchBlob("p/a.png")).text(), "x");
  assert.equal(await upload("o", new Blob(), "png"), "p/a.png");
  // Stable across reads, so a hook keyed on the function does not refetch.
  assert.equal(facade.assets.fetchBlob, fetchBlob);
});
