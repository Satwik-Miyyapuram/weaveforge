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

const CORE = String.raw`["']@weaveforge\/core(?:\/[^"']*)?["']`;

/** Bare names in an import or destructuring list: `a`, `b as c` and `b: c` all give the first name. */
function listNames(list: string): string[] {
  return list
    .split(",")
    .map((part) => part.trim())
    .filter((spec) => spec && !spec.startsWith("type "))
    .map((spec) => (spec.split(/\s+as\s+|\s*:\s*/).at(0) ?? "").trim());
}

/**
 * Names a file takes from @weaveforge/core (or a subpath), without `type` imports:
 * named imports and re-exports, destructured dynamic imports, and `ns.name` on a
 * namespace import.
 */
function coreImports(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(new RegExp(String.raw`(?:import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*${CORE}`, "g"))) {
    if (!m[1]) names.push(...listNames(m[2] ?? ""));
  }
  for (const m of text.matchAll(new RegExp(String.raw`\{([^}]*)\}\s*=\s*await\s+import\(\s*${CORE}\s*\)`, "g"))) {
    names.push(...listNames(m[1] ?? ""));
  }
  for (const m of text.matchAll(new RegExp(String.raw`import\s+\*\s+as\s+(\w+)\s+from\s*${CORE}`, "g"))) {
    for (const use of text.matchAll(new RegExp(String.raw`\b${m[1]}\.(\w+)`, "g"))) names.push(use[1] ?? "");
  }
  return names;
}

test("coreImports reads value names and skips type imports", () => {
  const text = `import { a, type B, c as d } from "@weaveforge/core";\nimport type { E } from "@weaveforge/core";\nexport { f } from '@weaveforge/core';`;
  assert.deepEqual(coreImports(text), ["a", "c", "f"]);
});

test("coreImports reads subpaths, dynamic imports and namespace uses", () => {
  const text = [
    `import { g } from "@weaveforge/core/org-crypto";`,
    `const { h, i: j } = await import("@weaveforge/core");`,
    `import * as wf from "@weaveforge/core";`,
    `wf.k(wf.l);`,
  ].join("\n");
  assert.deepEqual(coreImports(text), ["g", "h", "i", "k", "l"]);
});

test("app code takes Rust-owned functions from the Rust core, not @weaveforge/core", () => {
  const offenders = appFiles(src).flatMap((file) =>
    coreImports(readFileSync(file, "utf8"))
      .filter((name) => RUST_OWNED.includes(name))
      .map((name) => `${file.slice(src.length)}: ${name}`),
  );
  assert.deepEqual(offenders, []);
});
