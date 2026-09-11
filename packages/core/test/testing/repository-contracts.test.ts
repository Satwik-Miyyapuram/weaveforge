/**
 * The contract suites are the mechanism that keeps implementations
 * substitutable — which only works if they are (a) actually run and (b) cover
 * the whole port, including the lossy methods.
 *
 * Review-2 F4 found the opposite: suites that ran against one in-memory double
 * each, and never touched `listSummaries`. Review-2 F6 found that the shipped
 * Supabase adapters return a *reduced* shape under those methods. These tests
 * make both facts checkable in CI rather than in a review.
 *
 * What this file deliberately does NOT do is exercise the Supabase adapters
 * themselves: they live in `apps/web/src/**`, outside this package, and wiring
 * them here would mean core importing the web app. That remains a follow-up —
 * see the comment on `REAL_ADAPTERS` at the end.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const coreRoot = path.resolve(here, "../..");
const testingIndex = fs.readFileSync(path.join(coreRoot, "src/testing/index.ts"), "utf8");

/** Every `run*Contract` the package exports. */
const exportedRunners = [...testingIndex.matchAll(/from "\.\/([\w-]+-contract)\.js"/g)]
  .map((m) => m[1]!)
  .map((file) => {
    const source = fs.readFileSync(path.join(coreRoot, `src/testing/${file}.ts`), "utf8");
    return { file, source };
  });

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFiles(full));
    else if (entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

test("every exported contract runner is called somewhere in the test tree", () => {
  const allTests = testFiles(path.join(coreRoot, "test"))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  for (const { file, source } of exportedRunners) {
    const names = [...source.matchAll(/export function (run\w+Contract)/g)].map((m) => m[1]!);
    assert.ok(names.length > 0, `${file} exports no runner`);
    for (const name of names) {
      assert.ok(
        allTests.includes(`${name}(`),
        `${name} is exported but never run — a contract nobody executes cannot catch a broken adapter`,
      );
    }
  }
});

test("the summary methods are covered, not just declared", () => {
  // F4c: `listSummaries` was the one lossy method no suite touched. The suites
  // now assert it explicitly, including the case where an adapter does not
  // implement it at all.
  for (const file of ["paper-repository-contract", "vault-page-repository-contract"]) {
    const source = fs.readFileSync(path.join(coreRoot, `src/testing/${file}.ts`), "utf8");
    assert.ok(
      source.includes("listSummaries"),
      `${file} does not cover listSummaries`,
    );
  }
});

test("every runner registers tests rather than returning assertions", () => {
  // A runner that collected results into a return value would need a caller to
  // assert on it, and one that quietly registered nothing would leave CI green
  // over an adapter nobody checked. Requiring the registration to be literal
  // keeps both impossible to do by accident.
  for (const { file, source } of exportedRunners) {
    const registrations = [...source.matchAll(/^\s{2}test\(/gm)].length;
    assert.ok(
      registrations > 0,
      `${file} registers no tests — a contract that asserts nothing passes everything`,
    );
  }
});

// ---------------------------------------------------------------------------
// REAL_ADAPTERS — still not exercised, and why
//
// The Supabase adapters (`apps/web/src/features/*/infrastructure/supabase-*-repository.ts`)
// and the Python API adapters implement these same ports, and none of them is
// run through a contract suite here. Wiring them is not a core change:
//
//   * the TypeScript ones need a live Supabase (or the PGlite harness) and live
//     under `apps/web`, which `packages/core` must not import;
//   * the Python one is covered by `python/weaveforge/testing/contracts.py`,
//     which is run against the in-memory doubles only.
//
// So the follow-up is an app-side integration suite that constructs each
// Supabase adapter over the test database and calls these same runners — the
// suites are already written to accept a factory, which is the half this
// package can supply. Reported by the core/Python pass of review-2 as F4(a),
// unfixed on the app side.
// ---------------------------------------------------------------------------
