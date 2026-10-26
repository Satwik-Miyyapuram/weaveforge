/**
 * Next refuses to build a module whose "use client" comes after an import.
 * A codemod that adds an import at line 1 does exactly that, and only the
 * production build notices, so this test catches it with the unit suite.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sources(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/** True when the directive is present but some statement comes before it. */
export function directiveMisplaced(text: string): boolean {
  if (!/^["']use client["'];?\s*$/m.test(text)) return false;
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const first = code.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return !/^["']use client["'];?\s*$/.test(first.trim());
}

test("the directive check passes a comment first and fails an import first", () => {
  assert.equal(directiveMisplaced('// generated\n"use client";\nimport a from "a";'), false);
  assert.equal(directiveMisplaced('"use client";\nimport a from "a";'), false);
  assert.equal(directiveMisplaced('import a from "a";\n"use client";'), true);
  assert.equal(directiveMisplaced('import a from "a";'), false);
});

test('"use client" is the first statement wherever it appears', () => {
  const bad = sources(src).filter((f) => directiveMisplaced(readFileSync(f, "utf8")));
  assert.deepEqual(bad.map((f) => path.relative(src, f)), []);
});
