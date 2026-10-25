import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { localArtifactWriter, serveLocalArtifact } from "../src/local-artifacts";

async function root(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "weaveforge-artifacts-"));
}

test("a saved artifact is served back from its URL", async () => {
  const dir = await root();
  const url = await localArtifactWriter(dir)("exp-1", "loss.png", Buffer.from("png bytes"));
  const answer = await serveLocalArtifact(dir, url);
  assert.equal(answer.status, 200);
  assert.equal(await answer.text(), "png bytes");
});

test("a URL with the wrong number of segments is a 404", async () => {
  const answer = await serveLocalArtifact(await root(), "app://artifacts/exp-1/loss.png");
  assert.equal(answer.status, 404);
});

test("a segment that would leave the folder is a 404", async () => {
  const answer = await serveLocalArtifact(await root(), "app://artifacts/exp-1/%2E%2E/loss.png");
  assert.equal(answer.status, 404);
});

// 37-05: decodeURIComponent throws on a broken escape; the handler answers instead.
test("a malformed percent escape is a 400, not a rejected handler", async () => {
  const answer = await serveLocalArtifact(await root(), "app://artifacts/exp-1/%E0%A4/loss.png");
  assert.equal(answer.status, 400);
});
