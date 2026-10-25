/**
 * Notes live at `/notes`. The old `/vault` route is gone, so nothing in the web
 * app may link to it (it would 404). "vault" stays as the internal feature name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test("there is no /vault app route", () => {
  assert.equal(existsSync(join(src, "app", "vault")), false);
});

test("no web source links to the /vault route", () => {
  const route = /["'`]\/vault(?:[?#"'`/]|\$\{)/;
  const hits = sourceFiles(src).filter((file) => route.test(readFileSync(file, "utf8")));
  assert.deepEqual(hits, []);
});
