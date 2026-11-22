import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** 0.9.8 has no local-mode branch: nothing outside the local provider folder reads isLocalMode, LocalRunner or the badge. */

const SRC = fileURLToPath(new URL("../../../", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("no source file outside the local provider folder uses the local-mode gate, LocalRunner or the badge", () => {
  const offenders = walk(SRC)
    .filter((f) => /\.(ts|tsx|css)$/.test(f))
    .filter((f) => !/[\\/]test[\\/]/.test(f))
    .filter((f) => !/[\\/]backend[\\/]providers[\\/]local[\\/]/.test(f))
    .filter((f) => /\bisLocalMode\b|\bLocalRunner\b|LocalModeBadge|local-mode-badge/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders.map((f) => relative(SRC, f)), []);
});
