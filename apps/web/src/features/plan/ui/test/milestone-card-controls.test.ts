/**
 * A milestone card had a checkbox and a status select for one job, chips that
 * began "milestone …", "external …" or "A100 ×4 ~160h" with nothing saying
 * what they were, and an overdue count in the same grey as "in 3d"
 * (design D22, DA-140). The checkbox alone marks done; the other statuses move
 * into the card menu; the chip rows say "Waits for:" and "Compute:"; overdue
 * stands out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const card = readFileSync(fileURLToPath(new URL("../milestone-card.tsx", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("../../../../app/styles/git.css", import.meta.url)), "utf8");

test("the checkbox is the one control on the card face for done", () => {
  assert.doesNotMatch(card, /<StatusSelect/);
  assert.match(card, /className="themed-check milestone-check"/);
  // The face shows the shared status pill, tinted per status like every other card.
  assert.match(card, /status=\{<span className=\{`status status-\$\{m\.status\}`\}>\{statusLabel\(m\.status\)\}<\/span>\}/);
});

test("the other statuses live in the card menu", () => {
  assert.match(card, /id: "status",\s*label: "Status",/);
  assert.match(card, /submenu: MILESTONE_STATUSES\.map\(\(st\) => \(\{/);
  assert.match(card, /kind: "check",\s*checked: st === m\.status,/);
});

test("chip rows say what they hold", () => {
  assert.match(card, /<span className="plan-chips-label">Waits for:<\/span>/);
  assert.match(card, /<span className="plan-chips-label">Compute:<\/span>/);
  assert.match(css, /\.plan-chips-label \{/);
});

test("overdue stands out from the rest of the due line", () => {
  assert.match(card, /<strong className="milestone-overdue">\{-due\}d overdue<\/strong>/);
  assert.match(css, /\.milestone-overdue \{[^}]*color: var\(--danger\)/);
});
