/** The primary button opens the form, and create lands on the result (D13: DA-71, DA-72). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { addedPaperMessage } from "../../features/papers/ui/add-paper-form";
import { untitledTitle } from "../../features/vault/application/untitled-title";

const root = fileURLToPath(new URL("../../", import.meta.url));
const src = (rel: string) => readFileSync(join(root, rel), "utf8");

const SCREENS = {
  papers: "features/papers/ui/papers-list.tsx",
  notes: "features/vault/ui/vault-screen/vault-screen.tsx",
  experiments: "features/experiments/ui/experiments-screen.tsx",
  graph: "features/relations/ui/graph-screen.tsx",
};

test("no create button opens a chooser first (DA-71)", () => {
  for (const [name, file] of Object.entries(SCREENS)) {
    const s = src(file);
    assert.ok(!s.includes("org-choice-card"), `${name}: chooser card`);
    assert.ok(!/composeMode/.test(s), `${name}: chooser mode`);
  }
});

test("imports and side actions stay reachable from the More menu", () => {
  const papers = src(SCREENS.papers);
  assert.match(papers, /label: syncing \? "Syncing…" : "Sync Zotero"/);
  assert.match(papers, /"Read Zotero on this computer"/);
  const notes = src(SCREENS.notes);
  assert.match(notes, /"Import zip…"/);
  assert.match(notes, /"Import folder…"/);
  const exps = src(SCREENS.experiments);
  assert.match(exps, /"Python SDK token"/);
  assert.match(exps, /"Share all"/);
  assert.match(src(SCREENS.graph), /"Auto-link citations"/);
});

test("the graph's create button says what it does", () => {
  const s = src(SCREENS.graph);
  assert.ok(!s.includes('"+ Graph"'));
  assert.match(s, /title="Link papers"/);
});

test("adding a paper says whether it was new (E10)", () => {
  assert.equal(addedPaperMessage(true), "Paper added");
  assert.equal(addedPaperMessage(false), "Already in library");
  assert.match(src(SCREENS.papers), /showToast\(addedPaperMessage\(created\), \{ label: "Open"/);
});

test("a new note is Untitled, numbered past existing ones", () => {
  assert.equal(untitledTitle([]), "Untitled");
  assert.equal(untitledTitle(["Other"]), "Untitled");
  assert.equal(untitledTitle(["untitled"]), "Untitled (2)");
  assert.equal(untitledTitle(["Untitled", "Untitled (2)"]), "Untitled (3)");
});

test("a new note opens with its title focused", () => {
  assert.match(src("features/vault/ui/vault-screen/page-editor.tsx"), /autoFocus=\{focusTitle\}/);
  assert.match(src(SCREENS.notes), /focusTitle=\{newPageId === shownPage\.id\}/);
});

test("a new experiment toasts with Open", () => {
  assert.match(src(SCREENS.experiments), /showToast\("Experiment created", \{ label: "Open"/);
});
