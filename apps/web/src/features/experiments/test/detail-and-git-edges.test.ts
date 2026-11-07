// Source-match guards for detail-screen and git-screen edge cases (stale load, clipboard failure, busy track, sequence guard).
// Fails if the fixed code is removed; runs without rendering the components.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const detail = readFileSync(new URL("../ui/experiment-detail-screen.tsx", import.meta.url), "utf8");
const git = readFileSync(new URL("../../sync/ui/git-screen.tsx", import.meta.url), "utf8");

test("detail screen resets state on id change and drops stale responses", () => {
  assert.match(detail, /const currentId = useRef\(id\);/);
  assert.match(detail, /useEffect\(\(\) => \{\s*setExp\(null\);\s*setLoading\(true\);\s*setError\(null\);\s*\}, \[id\]\);/);
  assert.match(detail, /if \(currentId\.current !== forId\) return;/);
});

test("copy run command handles clipboard failure and clears its timer", () => {
  assert.match(detail, /setStatusError\("Could not copy to the clipboard\."\);/);
  assert.match(detail, /if \(copyTimer\.current\) clearTimeout\(copyTimer\.current\);/);
  assert.match(detail, /useEffect\(\(\) => \(\) => \{\s*if \(copyTimer\.current\) clearTimeout\(copyTimer\.current\);\s*\}, \[\]\);/);
});

test("git track is busy-guarded and reports success as a notice", () => {
  assert.match(git, /if \(!integration \|\| busy\) return;/);
  assert.match(git, /disabled=\{busy\}/);
  assert.match(git, /setNotice\(`Tracked “\$\{c\.message\}” as an experiment\.`\);/);
  assert.match(git, /<p className="muted" role="status">\{notice\}<\/p>/);
});

test("git branch load ignores a slower earlier request", () => {
  assert.match(git, /const mine = \+\+seq\.current;/);
  assert.match(git, /if \(mine !== seq\.current\) return;/);
});
