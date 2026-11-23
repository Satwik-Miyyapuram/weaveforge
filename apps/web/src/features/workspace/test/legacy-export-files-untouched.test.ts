/**
 * 0.9.7 wrote `.weaveforge/restore-pending.json` and `.weaveforge/tables/*.json` into the
 * workspace folder. They are the user's only copy of the old server rows, so 0.9.8 must
 * neither read them back into anything nor delete them. Pinned by a source scan of every
 * production source file under apps/web/src (crates/ and packages/ are out of scope). A static
 * scan cannot prove a computed path never reaches a remove, so the delete check is: no line that
 * removes, renames or trashes names the meta folder or a 0.9.7 export file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../../", import.meta.url));

function productionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "test" || entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...productionFiles(full));
    } else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = productionFiles(SRC).map((full) => ({
  rel: path.relative(SRC, full).split(path.sep).join("/"),
  text: readFileSync(full, "utf8"),
}));

test("the scan sees the workspace application files", () => {
  assert.ok(files.some((f) => f.rel === "features/workspace/application/parts-2.ts"), "scan root is apps/web/src");
});

test("no production file names restore-pending.json", () => {
  const hits = files.filter((f) => /restore-pending/.test(f.text)).map((f) => f.rel);
  assert.deepEqual(hits, []);
});

test(".weaveforge/tables is named only in a mirror comment", () => {
  const hits = files.filter((f) => /weaveforge\/tables/.test(f.text)).map((f) => f.rel).sort();
  assert.deepEqual(hits, ["features/workspace/application/parts-2.ts"]);
  const mirror = files.find((f) => f.rel === "features/workspace/application/parts-2.ts")!.text;
  for (const line of mirror.split("\n").filter((l) => /weaveforge\/tables/.test(l))) {
    assert.match(line.trim(), /^\*/, `parts-2.ts names the folder only in a comment: ${line.trim()}`);
  }
});

test("no production file imports sync-tables or passes extra mirror files", () => {
  assert.deepEqual(files.filter((f) => /["'][^"']*\/sync-tables(\.[jt]s)?["']/.test(f.text)).map((f) => f.rel), []);
  const extra = files.filter((f) => /extraFiles\s*:/.test(f.text)).map((f) => f.rel);
  assert.deepEqual(extra, [], "no caller hands the mirror the table files to write");
});

test("the mirrorWorkspace body itself calls no remove or rename (helpers: see the line scan below)", () => {
  const mirror = files.find((f) => f.rel === "features/workspace/application/parts-2.ts")!.text;
  const start = mirror.indexOf("const serializedWorkspace = await keepClaimedCanvasIds(");
  assert.ok(start > 0, "mirrorWorkspace body found");
  const body = mirror.slice(start, mirror.indexOf("\n}\n", start));
  assert.doesNotMatch(body, /\.remove\(|\.rename\(|unlink/);
});

test("no production line that removes, renames or trashes names the meta folder or a 0.9.7 export file", () => {
  const write = /\.(remove|rename|trash|unlink|rmdir|rm)\w*\(/;
  const legacy = /META_DIR|\.weaveforge|restore-pending|migration-0\.9\.7|weaveforge\/tables/;
  const hits = files.flatMap((f) =>
    f.text.split("\n").flatMap((line, i) => (write.test(line) && legacy.test(line) ? [`${f.rel}:${i + 1}`] : [])),
  );
  assert.deepEqual(hits, []);
});
