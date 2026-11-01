import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Functions the web calls through the Rust core (`readyCore()` / `loadCore()`).
// Importing their TypeScript twins from @weaveforge/core would quietly bring
// the old copy back, so app code must not.
const RUST_OWNED = [
  "changedSide",
  "entityDir",
  "imageAltFromFilename",
  "imageExtensionForMime",
  "imagePathsInBody",
  "isAppOwnedPath",
  "jsonKindOfPath",
  "markdownImage",
  "normalizeMarkdownImageSyntax",
  "projectDir",
  "toRelativeBlobLinks",
];

const src = fileURLToPath(new URL("../../", import.meta.url));

function appFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : appFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Names a file imports or re-exports from @weaveforge/core, without `type` imports. */
function coreImports(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/(?:import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*["']@weaveforge\/core["']/g)) {
    if (m[1]) continue;
    for (const part of (m[2] ?? "").split(",")) {
      const spec = part.trim();
      if (!spec || spec.startsWith("type ")) continue;
      names.push((spec.split(/\s+as\s+/).at(0) ?? "").trim());
    }
  }
  return names;
}

test("coreImports reads value names and skips type imports", () => {
  const text = `import { a, type B, c as d } from "@weaveforge/core";\nimport type { E } from "@weaveforge/core";\nexport { f } from '@weaveforge/core';`;
  assert.deepEqual(coreImports(text), ["a", "c", "f"]);
});

test("app code takes Rust-owned functions from the Rust core, not @weaveforge/core", () => {
  const offenders = appFiles(src).flatMap((file) =>
    coreImports(readFileSync(file, "utf8"))
      .filter((name) => RUST_OWNED.includes(name))
      .map((name) => `${file.slice(src.length)}: ${name}`),
  );
  assert.deepEqual(offenders, []);
});
