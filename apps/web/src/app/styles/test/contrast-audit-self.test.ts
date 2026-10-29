/**
 * The contrast gate (G7) is a hard failure (design D20, R9). It used to read
 * hex only, so the confetti themes' oklch card tints were never measured, and
 * a pair token written in any other form was skipped without a word. These run
 * the real script on a planted themes folder, so a theme it cannot read fails
 * here instead of passing.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const audit = fileURLToPath(new URL("../../../../scripts/contrast-audit.mjs", import.meta.url));

// A base every pair clears: black and dark ramps on white.
const BASE = `:root {
  --bg: #ffffff; --surface2: #ffffff; --text: #000000; --muted: #333333; --faint: #555555;
  --accent: #000000; --accent-fg: #ffffff;
  ${["neutral", "info", "good", "warn", "danger", "mute"].map((k) => `--s-${k}: #000000; --s-${k}-bg: #ffffff;`).join(" ")}
}
:root { --accent-ink: var(--accent); }
`;

function runAudit(themes: Record<string, string> = {}, args: string[] = []) {
  const dir = mkdtempSync(path.join(tmpdir(), "contrast-"));
  try {
    writeFileSync(path.join(dir, "light.css"), BASE);
    for (const [name, text] of Object.entries(themes)) writeFileSync(path.join(dir, name), text);
    const r = spawnSync(process.execPath, [audit, dir, ...args], { encoding: "utf8" });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a planted base that clears every pair passes", () => {
  const r = runAudit();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /0 pair\(s\) below their bar/);
});

test("the real themes pass", () => {
  const r = spawnSync(process.execPath, [audit], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
});

test("an oklch card tint is measured, and grey text on it fails", () => {
  const r = runAudit({
    "confetti.css": `[data-theme="confetti"] { --bg: #ffffff; --muted: #888888; --confetti-1-bg: oklch(0.966 0.030 350); }`,
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /✗ muted on card tint 1 .*FAIL/);
  assert.match(r.out, /  text on card tint 1 /, "black text on the same tint is measured and passes");
});

test("oklch and rgb() are read the same as the hex they stand for", () => {
  const r = runAudit({
    "x.css": `[data-theme="x"] { --bg: oklch(1 0 0); --text: rgb(0 0 0); --muted: rgb(51, 51, 51); }`,
  });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /body text on bg\s+21\.00  ok/);
});

test("a pair token the script cannot read fails instead of falling back to Paper", () => {
  const r = runAudit({ "x.css": `[data-theme="x"] { --bg: #ffffff; --text: color-mix(in srgb, red, blue); }` });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /✗ body text on bg .*cannot read --text/);
});

test("a see-through colour fails: its contrast depends on what is under it", () => {
  const r = runAudit({ "x.css": `[data-theme="x"] { --bg: #ffffff; --text: rgb(0 0 0 / 0.5); }` });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /cannot read --text/);
});

test("faint text below its 3:1 bar counts as a failure too", () => {
  const r = runAudit({ "x.css": `[data-theme="x"] { --bg: #ffffff; --faint: #eeeeee; }` });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /✗ faint text on bg .*FAIL \(< 3\)/);
});

test("a var() alias resolves inside the theme", () => {
  const r = runAudit({ "x.css": `[data-theme="x"] { --bg: #ffffff; --ink: #000000; --text: var(--ink); --accent: #ffffff; --accent-fg: #000000; }` });
  // accent-ink follows the theme's white accent onto white.
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /body text on bg\s+21\.00  ok/);
  assert.match(r.out, /✗ accent-as-text on bg/);
});
