/**
 * The UI gate (G1 and its siblings) is a hard failure (design D20, R9). These
 * run the real script on a planted tree, so a gate that stops seeing a file,
 * or quietly turns into a ratchet, fails here instead of passing everything.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const gate = fileURLToPath(new URL("../../../../../scripts/check-ui-consistency.mjs", import.meta.url));

/** Run the gate on a tree holding just `files` (path from the repo root → text). */
function runGate(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "ui-gate-"));
  try {
    for (const dir of ["features", "app", "components"]) mkdirSync(path.join(root, "apps/web/src", dir), { recursive: true });
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), text);
    }
    const r = spawnSync(process.execPath, [gate], { env: { ...process.env, UI_GATE_ROOT: root }, encoding: "utf8" });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a raw <button> in a screen fails the gate and names the file (G1)", () => {
  const r = runGate({ "apps/web/src/features/papers/ui/x.tsx": "export const X = () => <button>Go</button>;\n" });
  assert.equal(r.code, 1);
  assert.match(r.out, /raw <button> \(G1\)/);
  assert.match(r.out, /apps\/web\/src\/features\/papers\/ui\/x\.tsx:1/);
});

test("a .ts file is scanned too, not only .tsx", () => {
  // Joined here so the real gate, scanning this file, does not see the call.
  const call = ["window", "confirm('sure?')"].join(".");
  const r = runGate({ "apps/web/src/features/reader/ui/use-x.ts": `export const ask = () => ${call};\n` });
  assert.equal(r.code, 1);
  assert.match(r.out, /OS confirmation dialog/);
});

test("the button primitives may write <button>, and a clean tree passes", () => {
  const r = runGate({
    "apps/web/src/components/button.tsx": "export const B = () => <button />;\n",
    "apps/web/src/components/controls.tsx": "export const C = () => <button />;\n",
    "apps/web/src/features/papers/ui/x.tsx": "export const X = () => <Button>Go</Button>;\n",
  });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /UI consistency checks passed/);
});

test("the gate has no ratchet: every rule fails on its first hit", () => {
  assert.doesNotMatch(readFileSync(gate, "utf8"), /ceiling/);
});
