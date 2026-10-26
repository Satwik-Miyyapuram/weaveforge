/**
 * No system confirm dialog (design D10, DA-61). A delete happens at once with
 * an Undo toast; the few losses undo cannot reach use ConfirmDialog.
 *
 * The two error boundaries keep `window.confirm` on purpose: they render when
 * the tree that draws ConfirmDialog may be what failed.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ALLOWED = new Set(["app/global-error.tsx", "app/route-error.tsx"]);

/**
 * Calls of the global `confirm` / `window.confirm`, comments ignored. A bare
 * `confirm(` counts only where its result is used, so a method named
 * `confirm(...) {` is not a hit.
 */
export function confirmCalls(text: string): number {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  return [...code.matchAll(/(?:\bwindow\.|(?<=(?:[!(=&|?:,]|\breturn)\s*))confirm\s*\(/g)].length;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "test" && name !== "node_modules") walk(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

test("the scanner finds confirm() and window.confirm() but not a method or a comment", () => {
  assert.equal(confirmCalls(`if (!confirm("x")) return; window.confirm("y");`), 2);
  assert.equal(confirmCalls(`gate.confirm(id); onConfirm(); // confirm("x")
  confirm(pointerId: number) {}\n/* window.confirm() */`), 0);
});

test("no screen opens the system confirm dialog", () => {
  const hits = walk(src)
    .map((f) => path.relative(src, f).replaceAll("\\", "/"))
    .filter((rel) => !ALLOWED.has(rel) && confirmCalls(readFileSync(path.join(src, rel), "utf8")) > 0);
  assert.deepEqual(hits, []);
});
