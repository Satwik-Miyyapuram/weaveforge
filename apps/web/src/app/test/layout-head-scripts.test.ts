/** A string imported from a "use client" module makes a lazy child of <head>, which breaks hydration at random (React #418). */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("every script in the layout's head comes from a server module", () => {
  const layout = readFileSync(path.join(SRC, "app/layout.tsx"), "utf8");
  const head = layout.slice(layout.indexOf("<head>"), layout.indexOf("</head>"));
  const names = [...head.matchAll(/__html: (\w+)/g)].map((m) => m[1]);
  assert.ok(names.length >= 2, "found the boot scripts");
  for (const name of names) {
    const from = new RegExp("import [{][^}]*[ {]" + name + "[ ,}][^;]*from \"@/([^\"]+)\"").exec(layout)?.[1];
    assert.ok(from, name + " is imported");
    const file = [".ts", ".tsx"].map((ext) => path.join(SRC, from + ext)).find((f) => existsSync(f));
    assert.ok(file, from + " exists");
    assert.doesNotMatch(readFileSync(file, "utf8"), /^"use client"/m, from + " is a server module");
  }
});
