import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("wireBackend never selects local mode (PGlite) at runtime in 0.9.7", () => {
  const source = readFileSync(new URL("../parts.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export function wireBackend("));
  const fn = body.slice(0, body.indexOf("\n}\n") + 3);
  assert.ok(fn.length > 0, "wireBackend found");
  assert.doesNotMatch(fn, /isLocalMode|localBackendParts/);
});
