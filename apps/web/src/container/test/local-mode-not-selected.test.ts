import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("wireBackend never selects local mode (PGlite) at runtime in 0.9.8", () => {
  const source = read("../parts.ts");
  const body = source.slice(source.indexOf("export function wireBackend("));
  const fn = body.slice(0, body.indexOf("\n}\n") + 3);
  assert.ok(fn.length > 0, "wireBackend found");
  // isLocalMode is the no-account check (folder files), not PGlite, so it is allowed.
  assert.doesNotMatch(fn, /localBackendParts|localFirstActive|localFirstParts/);
});

test("the container wiring module does not import the local identity or local parts", () => {
  const source = read("../parts.ts");
  assert.doesNotMatch(source, /from ["'][^"']*local-identity["']/);
  assert.doesNotMatch(source, /from ["'][^"']*local\/parts["']/);
  assert.doesNotMatch(source, /from ["'][^"']*local-first(-marker)?["']/);
});
