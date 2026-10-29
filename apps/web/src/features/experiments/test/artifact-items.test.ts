/**
 * A stored figure is signed to `/api/blobs/content?t=…` on tiered storage: no
 * extension, last segment "content". Telling images from links, and naming
 * them, has to read the stored entry, which keeps the real filename.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
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
