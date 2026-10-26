/** Copy buttons say what happened (DA-64). */
import assert from "node:assert/strict";
import { test } from "node:test";

import { copyText } from "../copy-text";
import { toasts } from "../toast-store";

test("a copy shows a confirming toast", async () => {
  const written: string[] = [];
  await copyText("https://x/s/1", "Link copied", async (t) => void written.push(t));
  assert.deepEqual(written, ["https://x/s/1"]);
  assert.equal(toasts.snapshot().at(-1)?.message, "Link copied");
  toasts.flush();
});

test("a refused clipboard says so instead of claiming success", async () => {
  await copyText("x", "Link copied", () => Promise.reject(new Error("denied")));
  assert.equal(toasts.snapshot().at(-1)?.message, "Could not copy: denied");
  toasts.flush();
});
