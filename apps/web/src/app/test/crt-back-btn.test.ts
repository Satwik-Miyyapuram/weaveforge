/** The CRT back button looks like every other back button: cream box, ink shadow. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("the CRT back button has no colours of its own", () => {
  assert.doesNotMatch(read("../styles/record.css"), /:root\[data-theme="crt"\] \.back-btn-box/);
});

test("the CRT theme keeps its ink colour for text and shadows", () => {
  assert.match(read("../themes/crt.css"), /--text:\s*#2b222b;/i);
});
