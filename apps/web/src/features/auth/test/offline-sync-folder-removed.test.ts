import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 0.9.8 has no offline sync engine: its folder is gone and nothing in the app imports it. */

const SRC = fileURLToPath(new URL("../../../", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("the offline-sync feature folder is deleted", () => {
  assert.equal(existsSync(join(SRC, "features", "offline-sync")), false);
});

test("nothing in the app imports the offline-sync layer or its shared-row or transport modules", () => {
  const offenders = walk(SRC)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !/[\\/]test[\\/]/.test(f))
    .filter((f) => /offline-sync|shared-rows|postgrest-transport/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders.map((f) => f.slice(SRC.length)), []);
});
