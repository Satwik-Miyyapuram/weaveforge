/**
 * A stored figure is signed to `/api/blobs/content?t=…` on tiered storage: no
 * extension, last segment "content". Telling images from links, and naming
 * them, has to read the stored entry, which keeps the real filename.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});
import { artifactItems } from "../ui/artifact-items";

const SIGNED = "https://app.example/api/blobs/content?t=abc.def";

test("a signed storage figure is an image, named after its file", () => {
  const { images, links } = artifactItems(["u1/e1/uuid/loss%20curve.png"], [SIGNED]);
  assert.deepEqual(images, [{ url: SIGNED, label: "loss curve.png" }]);
  assert.deepEqual(links, []);
});

test("a signed non-image file is a link, named after its file", () => {
  const { images, links } = artifactItems(["u1/e1/uuid/model.ckpt"], [SIGNED]);
  assert.deepEqual(images, []);
  assert.deepEqual(links, [{ url: SIGNED, label: "model.ckpt" }]);
});

test("absolute links pass through as before", () => {
  const png = "https://cdn.example/fig/acc.png";
  const run = "https://wandb.ai/me/run/abc";
  const { images, links } = artifactItems([png, run], [png, run]);
  assert.deepEqual(images, [{ url: png, label: "acc.png" }]);
  assert.deepEqual(links, [{ url: run, label: "abc" }]);
});

test("an entry not signed yet (or that failed) is left out, and order is kept", () => {
  const a = "https://cdn.example/a.png";
  const b = "https://cdn.example/b.png";
  const { images } = artifactItems([a, "u1/e1/uuid/x.png", b], [a, null, b]);
  assert.deepEqual(images.map((i) => i.url), [a, b]);
});

test("unnamed inline figures are numbered within their group", () => {
  const d = "data:image/png;base64,AAAA";
  const { images } = artifactItems(["https://x.example/run", d], ["https://x.example/run", d]);
  assert.deepEqual(images, [{ url: d, label: "figure 1" }]);
});

test("a PDF is kept apart from other links, so it can open in the reader", () => {
  const pdf = "https://cdn.example/report.pdf";
  const run = "https://wandb.ai/me/run/abc";
  const { pdfs, links } = artifactItems(["u1/e1/uuid/paper.PDF", run, pdf], [SIGNED, run, pdf]);
  assert.deepEqual(pdfs, [
    { url: SIGNED, label: "paper.PDF" },
    { url: pdf, label: "report.pdf" },
  ]);
  assert.deepEqual(links, [{ url: run, label: "abc" }]);
});

test("a path still signing is left out; once settled with no URL it is missing", () => {
  const path = "u1/e1/uuid/x.png";
  assert.deepEqual(artifactItems([path], [null]).missing, []);
  assert.deepEqual(artifactItems([path], [null], { settled: true }).missing, [{ label: "x.png", reason: "missing" }]);
});

test("an absolute entry with no URL (an unsafe local path) is missing at once", () => {
  const { missing } = artifactItems(["app://artifacts/e/%2E%2E/x.png"], [null]);
  assert.deepEqual(missing, [{ label: "x.png", reason: "missing" }]);
});

test("a desktop-local file outside the shell is labelled on desktop only, not linked", () => {
  const entry = "app://artifacts/exp-1/uuid/loss.png";
  const web = artifactItems([entry], [entry], { inShell: false });
  assert.deepEqual(web.images, []);
  assert.deepEqual(web.missing, [{ label: "loss.png", reason: "desktop" }]);
  const shell = artifactItems([entry], ["/artifacts/exp-1/uuid/loss.png"], { inShell: true });
  assert.equal(shell.images.length, 1);
  assert.deepEqual(shell.missing, []);
});
