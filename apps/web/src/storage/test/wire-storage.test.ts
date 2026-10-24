/**
 * `wireStorage` runs in the browser container. Its tiered branch there is an
 * HTTP store; the S3 stores (and the AWS SDK under them) are server-only, so
 * a static import of them shipped the SDK to every visitor (10-03).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { blobProviderForRuntime, wireStorage } from "../wire-storage";
import { HttpBlobStore } from "../providers/http/http-blob-store";
import { SupabaseBlobStore } from "../providers/supabase/blob-store";
import type { StorageConfig } from "../config";

const SRC = path.resolve(__dirname, "../..");

/** Resolves an app import to its file, or null for a package. */
function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (candidate !== base || /\.tsx?$/.test(base)) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Every package a module loads at run time, following app imports through. */
function runtimePackages(entry: string): Map<string, string> {
  const packages = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [entry];
  // Type-only imports and re-exports are erased, so they load nothing.
  const importRe = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/gm;
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(importRe)) {
      const spec = match[1]!;
      const resolved = resolveImport(file, spec);
      if (resolved) queue.push(resolved);
      else if (!spec.startsWith("@/") && !spec.startsWith(".")) packages.set(spec, path.relative(SRC, file));
    }
  }
  return packages;
}

test("the browser storage wiring loads no AWS SDK (10-03)", () => {
  const packages = runtimePackages(path.join(SRC, "storage/wire-storage.ts"));
  const aws = [...packages].filter(([name]) => name.startsWith("@aws-sdk/"));
  assert.deepEqual(aws, [], `pulled in by: ${aws.map(([n, f]) => `${n} <- ${f}`).join(", ")}`);
});

test("the scan does see the SDK where it is imported, so the check above means something", () => {
  const packages = runtimePackages(path.join(SRC, "storage/build-tiered-blob-store.ts"));
  assert.ok([...packages.keys()].some((name) => name.startsWith("@aws-sdk/")));
});

const tiered = { provider: "tiered" } as StorageConfig;
const supabase = { provider: "supabase" } as StorageConfig;
const db = {} as SupabaseClient;

function inBrowser<T>(run: () => T): T {
  const g = globalThis as { window?: unknown };
  const had = "window" in g;
  const before = g.window;
  g.window = {};
  try {
    return run();
  } finally {
    if (had) g.window = before;
    else delete g.window;
  }
}

test("tiered storage in the browser is the HTTP store", () => {
  assert.ok(inBrowser(() => wireStorage({ config: tiered })) instanceof HttpBlobStore);
});

test("supabase storage is the Supabase store, and needs a client", () => {
  assert.ok(wireStorage({ config: supabase, supabaseDb: db }) instanceof SupabaseBlobStore);
  assert.throws(() => wireStorage({ config: supabase }), /requires a Supabase client/);
});

test("tiered storage off the browser points at the server builder rather than loading S3 here", () => {
  assert.throws(() => wireStorage({ config: tiered, supabaseDb: db }), /storage\/server\/blob-api/);
});

test("which blob provider the runtime uses (10-17)", () => {
  // The browser follows the inlined public setting, whatever config it was handed.
  assert.equal(blobProviderForRuntime("supabase", { inBrowser: true, publicProvider: "tiered" }), "tiered");
  assert.equal(blobProviderForRuntime("tiered", { inBrowser: true, publicProvider: undefined }), "tiered");
  assert.equal(blobProviderForRuntime("supabase", { inBrowser: true, publicProvider: "" }), "supabase");
  // The server follows its config.
  assert.equal(blobProviderForRuntime("supabase", { inBrowser: false, publicProvider: "tiered" }), "supabase");
  assert.equal(blobProviderForRuntime("tiered", { inBrowser: false, publicProvider: undefined }), "tiered");
});
