/**
 * The weights cache.
 *
 * The download itself is Electron's `net`, which is not here, so what is
 * tested is the part that decides where a file lands: a renderer composes
 * these URLs, and a URL that could name a path outside the cache directory
 * would be choosing where the shell writes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { cachePathFor } from "../src/model-cache";

const ROOT = path.join("C:", "cache", "models");

test("model cache: a repository path becomes a file under the cache root", () => {
  const at = cachePathFor(ROOT, "app://models/Xenova/all-MiniLM-L6-v2/resolve/main/config.json");

  assert.equal(at, path.join(ROOT, "Xenova", "all-MiniLM-L6-v2", "resolve", "main", "config.json"));
});

test("model cache: traversal cannot reach outside the cache directory", () => {
  // A plain `..` is resolved away by the URL itself before it is ever seen.
  assert.equal(cachePathFor(ROOT, "app://models/../../secrets.txt"), path.join(ROOT, "secrets.txt"));
  // An encoded one survives that, and is what the check is actually for.
  assert.equal(cachePathFor(ROOT, "app://models/a%2F..%2F..%2Fb"), null);
});

test("model cache: a request for nothing in particular is refused", () => {
  assert.equal(cachePathFor(ROOT, "app://models/"), null);
});
