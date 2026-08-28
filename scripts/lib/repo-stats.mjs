/**
 * What the repository measures at this commit.
 *
 * Two generators need the same numbers — the architecture map in Markdown and
 * the atlas page — and a second copy of "how we count a line" is how the two
 * came to disagree. Counting lives here; both import it.
 *
 * Only files git is tracking are counted. Walking the working tree counted
 * whatever happened to be lying in it — a stale build directory, a scratch
 * script — so the same commit measured differently here and on CI.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CODE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".css", ".sql"]);

export const TRACKED = execFileSync("git", ["ls-files", "-z"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean);

/** Digits a reader can scan, grouped the way they read them. */
export const n = (value) => value.toLocaleString("en-US");

export function read(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** Counted the way `wc -l` counts: a trailing newline does not open a line. */
function lineCount(text) {
  if (!text) return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

export function measure({ dir, unit }) {
  let lines = 0;
  let files = 0;
  for (const rel of TRACKED) {
    if (!rel.startsWith(`${dir}/`)) continue;
    const ext = path.extname(rel);
    if (unit === "files") {
      if (ext === ".sql" || ext === ".md") files += 1;
      continue;
    }
    if (!CODE.has(ext)) continue;
    files += 1;
    lines += lineCount(read(rel));
  }
  return { lines, files };
}

/** Tracked files directly under `dir`, or anywhere beneath it. */
export function filesUnder(dir, { ext } = {}) {
  return TRACKED.filter(
    (rel) => rel.startsWith(`${dir}/`) && (!ext || path.extname(rel) === ext),
  );
}

/** Every line of every tracked file under `dir`, whatever its extension. */
export function linesUnder(dir, ext) {
  return filesUnder(dir, { ext }).reduce((sum, rel) => sum + lineCount(read(rel)), 0);
}

/**
 * The feature slices of a source tree, in the order a reader would list them.
 *
 * A slice is a directory under `features/`, so this asks the tree rather than
 * a list someone has to remember to extend.
 */
export function featureSlices(dir) {
  const prefix = `${dir}/features/`;
  const names = new Set();
  for (const rel of TRACKED) {
    if (!rel.startsWith(prefix)) continue;
    const name = rel.slice(prefix.length).split("/")[0];
    if (name && !name.includes(".")) names.add(name);
  }
  return [...names].sort();
}

/** `0001 → 0120`, read off the migration filenames rather than remembered. */
export function migrations() {
  const files = filesUnder("supabase/migrations", { ext: ".sql" }).sort();
  const numberOf = (rel) => path.basename(rel).split("_")[0];
  return {
    count: files.length,
    first: files.length ? numberOf(files[0]) : "",
    last: files.length ? numberOf(files[files.length - 1]) : "",
    lines: linesUnder("supabase/migrations", ".sql"),
  };
}

/** Next.js routes: a `page.tsx` is a page, a `route.ts` is an API route. */
export function webRoutes() {
  const app = filesUnder("apps/web/src/app");
  return {
    pages: app.filter((rel) => path.basename(rel) === "page.tsx").length,
    apiRoutes: app.filter((rel) => path.basename(rel) === "route.ts").length,
  };
}

/** Every `case "name":` in a dispatch switch, in the order the code lists them. */
export function switchCases(rel) {
  return [...read(rel).matchAll(/case "([a-z_]+)":/g)].map((match) => match[1]);
}
