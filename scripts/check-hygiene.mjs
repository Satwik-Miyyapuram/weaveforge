#!/usr/bin/env node
/**
 * Source hygiene checks for CI / pre-PR.
 *
 * Each rule here exists because the repo has already been bitten by it once.
 * The corresponding prose lives in docs/dev.md § Source hygiene (enforced) —
 * when a rule changes, change both.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Tracked files, POSIX-separated, minus build output. */
function tracked(...globs) {
  return execSync(`git ls-files ${globs.map((g) => `"${g}"`).join(" ")}`, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1e8,
  })
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f && !f.includes("/dist/") && fs.existsSync(path.join(root, f)));
}

const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const failures = [];

function fail(rule, lines, fix) {
  failures.push({ rule, lines, fix });
}

// ---------------------------------------------------------------------------
// 1. Sources stay text, so git and grep can see them.
//
// A literal control byte anywhere in a file makes git classify the whole file
// as binary: it disappears from `git grep`, and its diffs stop rendering. Two
// files had already gone invisible this way, both from a control-character
// range typed literally into a regex.
// ---------------------------------------------------------------------------
{
  const offenders = [];
  for (const f of tracked("*.ts", "*.tsx", "*.mjs", "*.js", "*.py", "*.css", "*.md", "*.json")) {
    const bytes = fs.readFileSync(path.join(root, f));
    for (const b of bytes) {
      // Everything below space except tab/newline/carriage return, plus DEL.
      if (b < 9 || (b >= 11 && b <= 12) || (b >= 14 && b <= 31) || b === 127) {
        offenders.push(f);
        break;
      }
    }
  }
  if (offenders.length) {
    fail(
      "literal control characters make a file binary to git and invisible to grep",
      offenders,
      'write them as escapes instead: "\\u0000", /[\\u0000-\\u001f]/',
    );
  }
}

// ---------------------------------------------------------------------------
// 2. A file that outgrows itself becomes a folder.
//
// Past this size a file is no longer one thing, and every reader pays to find
// out which part they came for. The allowlist is not an exemption forever —
// it is the list of files still owed a split.
// ---------------------------------------------------------------------------
const MAX_FILE_LINES = 800;

/** Still over the cap, with the reason it has not been split yet. */
const OVERSIZED_ALLOWED = new Map([
  [
    "apps/web/src/features/reader/ui/pdf-reader/pdf-reader.tsx",
    "its handlers close over ~15 refs and setters; splitting them would move the tangle, not undo it",
  ],
]);

{
  const over = [];
  const stale = [];
  const sources = tracked("apps", "packages").filter(
    (f) => /^(apps|packages)\/[^/]+\/src\//.test(f) && /\.tsx?$/.test(f),
  );
  for (const f of sources) {
    const lines = read(f).split("\n").length;
    if (lines > MAX_FILE_LINES && !OVERSIZED_ALLOWED.has(f)) over.push(`${f} (${lines} lines)`);
  }
  for (const f of OVERSIZED_ALLOWED.keys()) {
    if (!fs.existsSync(path.join(root, f)) || read(f).split("\n").length <= MAX_FILE_LINES) {
      stale.push(f);
    }
  }
  if (over.length) {
    fail(
      `source files over ${MAX_FILE_LINES} lines`,
      over,
      "split into a folder of modules named for the pieces, with an index.ts (see docs/DESIGN.md § 3.2.2)",
    );
  }
  if (stale.length) {
    fail(
      "allowlisted as oversized but no longer are",
      stale,
      "delete the entry from OVERSIZED_ALLOWED in scripts/check-hygiene.mjs",
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Tests sit where their subject sits.
//
// `packages/core/test/` was 132 flat files, and finding the tests for one area
// meant knowing their names. Core tests now mirror `src/`; app tests live in a
// `test/` folder beside the code they exercise.
// ---------------------------------------------------------------------------
{
  // Listed by prefix rather than by a `**` glob: git's `**` wants at least one
  // directory, so the flat files this rule exists to catch never matched it.
  const coreTests = tracked("packages/core/test").filter((f) => f.endsWith(".test.ts"));

  const flat = coreTests.filter((f) => f.split("/").length === 4); // packages/core/test/<file>
  if (flat.length) {
    fail(
      "core tests sitting flat in test/ rather than under the src area they exercise",
      flat,
      "move to packages/core/test/<area>/ mirroring packages/core/src/<area>/",
    );
  }

  const unmirrored = coreTests
    .filter((f) => f.split("/").length > 4)
    .filter((f) => {
      const area = f.split("/").slice(3, -1).join("/");
      return !fs.existsSync(path.join(root, "packages/core/src", area));
    });
  if (unmirrored.length) {
    fail(
      "core test folders with no matching folder under src/",
      unmirrored,
      "rename the test folder to the src area it mirrors, or move the tests to the one that fits",
    );
  }

  const looseAppTests = tracked("apps")
    .filter((f) => /^apps\/[^/]+\/src\//.test(f) && /\.test\.tsx?$/.test(f))
    .filter((f) => !f.includes("/test/"));
  if (looseAppTests.length) {
    fail(
      "app tests outside a test/ folder",
      looseAppTests,
      "move to a test/ folder beside the module under test",
    );
  }
}

// ---------------------------------------------------------------------------
// 4. A request body's array is bounded before it is walked.
//
// Two routes took an array straight from the body and awaited one database
// round trip per element. The number of round trips one request can buy has to
// be a constant in the code, not a number the caller picks.
// ---------------------------------------------------------------------------
{
  const unbounded = tracked("apps/web/src/app/api").filter((f) => {
    if (!f.endsWith("/route.ts")) return false;
    const src = read(f);
    if (!src.includes("Array.isArray")) return false;
    return !/\.length\s*>/.test(src);
  });
  if (unbounded.length) {
    fail(
      "API routes that accept an array from the body without capping its length",
      unbounded,
      "compare .length against a named constant and answer 400 over the cap (see apps/web/src/storage/signed-url-limits.ts)",
    );
  }
}

// ---------------------------------------------------------------------------
// 5. A path a doc names is a path that exists.
//
// Renames and deletions do not touch prose, so docs quietly accumulate paths
// into files that were removed many commits ago. Two plans had drifted far
// enough that a reader following them landed on nothing at all.
//
// Only backticked repo-rooted paths count, and only in docs describing the code
// as it stands: a doc may propose a file that does not exist yet, so a line that
// introduces one is left alone.
// ---------------------------------------------------------------------------
{
  const REPO_PATH = /`((?:apps|packages|plugins|python|supabase|scripts)\/[A-Za-z0-9_.\/-]+)`/g;
  const PROPOSES = /\b(?:new|creates?|adds?|proposed?|would|will|when scheduled)\b/i;
  const missing = [];
  for (const doc of tracked("docs/**/*.md", "*.md")) {
    // Completed plans, and files that say outright they are records of what
    // was, are expected to name paths that are gone. Their banner is what stops
    // a reader believing them; a second warning here would say nothing new.
    if (doc.includes("/completed/") || /^>\s+\*\*(?:Historical|Predates)/m.test(read(doc))) continue;
    read(doc).split("\n").forEach((line, index) => {
      // A doc may elide the middle of a long path for readability.
      if (line.includes("/...")) return;
      if (PROPOSES.test(line)) return;
      for (const [, found] of line.matchAll(REPO_PATH)) {
        const target = found.replace(/\/$/, "");
        // Prose quotes import specifiers as often as file names, and those
        // carry no extension.
        const candidates = [target, target + ".ts", target + ".tsx", target + ".mjs"];
        if (candidates.some((candidate) => fs.existsSync(path.join(root, candidate)))) continue;
        missing.push(doc + ":" + (index + 1) + " " + target);
      }
    });
  }
  if (missing.length) {
    fail(
      "docs naming a path that does not exist",
      missing,
      "point the doc at what is there now, or mark the file historical if it is a record rather than a guide",
    );
  }
}

// ---------------------------------------------------------------------------

if (failures.length) {
  for (const { rule, lines, fix } of failures) {
    console.error(`FAIL: ${rule}`);
    for (const line of lines) console.error(`  ${line}`);
    console.error(`  fix: ${fix}\n`);
  }
  console.error("See docs/dev.md § Source hygiene (enforced).");
  process.exit(1);
}

console.log("check:hygiene passed");
