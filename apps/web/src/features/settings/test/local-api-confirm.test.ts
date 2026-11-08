// Desktop Settings › AI is one switch that serves MCP at once. Turning it on
// opens a local door to the workspace, so it asks first; Cancel leaves it off.
// Turning it off needs no question. (The modal portals, so this reads source.)
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const panel = readFileSync(fileURLToPath(new URL("../ui/local-api-panel.tsx", import.meta.url)), "utf8");

test("turning the switch on asks first instead of serving straight away", () => {
  assert.match(panel, /onChange=\{\(on\) => \(on \? setAsking\(true\) : void setEnabled\(false\)\)\}/);
  assert.match(panel, /<ConfirmDialog/);
  assert.match(panel, /title=\{sdk \? "Let programs connect\?" : "Turn on AI access\?"\}/);
});

test("only the confirm button turns it on; Cancel just closes", () => {
  assert.match(panel, /onConfirm=\{\(\) => \{\s*setAsking\(false\);\s*void setEnabled\(true\);\s*\}\}/);
  assert.match(panel, /onClose=\{\(\) => setAsking\(false\)\}/);
  assert.equal(panel.match(/setEnabled\(true\)/g)?.length, 1);
});
