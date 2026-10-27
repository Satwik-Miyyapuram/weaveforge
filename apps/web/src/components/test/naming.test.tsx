/** One name per action and thing (D12: D-15 verb rule, D-16, D-17, D-19, D-20, D-05, DA-77, DA-78). */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { ROLE_LABELS } from "@weaveforge/core";

import { LIST_COLOR_NAMES, LIST_COLOR_PRESETS } from "../../features/reading-lists/ui/list-ui";

const root = fileURLToPath(new URL("../../", import.meta.url));
const src = (rel: string) => readFileSync(join(root, rel), "utf8");

function uiFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "test" ? [] : uiFiles(p);
    return /\.tsx?$/.test(p) ? [p] : [];
  });
}

test("no UI file humanises an enum by hand (D-16)", () => {
  const offenders = uiFiles(join(root, "features"))
    .concat(uiFiles(join(root, "components")))
    .filter((f) => /\.replace\(\s*("_"|\/_\/g)/.test(readFileSync(f, "utf8")))
    .map((f) => relative(root, f).replace(/\\/g, "/"));
  // Sync issues name raw table and column ids, and the plan widget theme
  // decodes next/font family names ("__JetBrains_Mono_9c1a"): not enums.
  const notEnums = ["sync-issues-panel.tsx", "plan-widget-theme.tsx"];
  assert.deepEqual(offenders.filter((f) => !notEnums.some((name) => f.endsWith(name))), []);
});

/** [file, button-or-header text, dialog title, submit text] per create flow. */
const FLOWS: Array<[string, string, string, string, string]> = [
  ["lists", "features/reading-lists/ui/lists-screen.tsx", "New list", "features/reading-lists/ui/add-list-form.tsx", "Create"],
  ["plan", "features/plan/ui/plan-screen.tsx", "New milestone", "features/plan/ui/milestone-form.tsx", "Create"],
  ["logbook", "features/logbook/ui/logbook-screen.tsx", "New entry", "features/logbook/ui/add-log-entry-form.tsx", "Create"],
  ["report", "features/report/ui/report-screen.tsx", "New section", "features/report/ui/add-section-form.tsx", "Create"],
  ["experiments", "features/experiments/ui/experiments-screen.tsx", "New experiment", "features/experiments/ui/add-experiment-form.tsx", "Create"],
];

test("a create button, its dialog title and its submit agree (D-15)", () => {
  for (const [name, screen, label, form, submit] of FLOWS) {
    const s = src(screen);
    assert.match(s, new RegExp(`>\\s*${label}\\s*</Button>`), `${name}: button`);
    assert.match(s, new RegExp(`title=\\{?[^\\n]*"${label}"`), `${name}: dialog title`);
    assert.match(src(form), new RegExp(`"${submit}"`), `${name}: submit`);
  }
  // Adding to the library is "Add", not "Create": the paper already exists.
  const papers = src("features/papers/ui/papers-list.tsx");
  assert.doesNotMatch(papers, /"Add a paper"|"Add papers"/);
  assert.match(src("features/papers/ui/add-paper-form.tsx"), /"Add paper"/);
});

test("the old names are gone (DA-70, D-17, D-19, D-20)", () => {
  const all = uiFiles(join(root, "features")).map((f) => readFileSync(f, "utf8")).join("\n");
  for (const old of [
    "Log an experiment", "Log run", "Add a milestone", "Add a log entry", "Add a section",
    "New reading list", "Linked from", "Linked mentions", "Publish snapshot",
    "Export LaTeX", "Export to Overleaf", "Re-render template", "— top level —",
  ]) {
    assert.ok(!all.includes(old), old);
  }
});

test("note backlinks are 'Links here' (D-17)", () => {
  assert.match(src("features/vault/ui/vault-screen/page-editor.tsx"), /"Links here"/);
});

test("check-ins are 'Send check-in' (D-19)", () => {
  assert.match(src("features/logbook/ui/logbook-screen.tsx"), /Send check-in/);
});

test("Overleaf export is 'Export for Overleaf' (D-20)", () => {
  assert.match(src("features/report/ui/export-overleaf-package-panel.tsx"), /Export for Overleaf/);
  assert.match(src("features/report/ui/report-overleaf-screen.tsx"), /Export for Overleaf/);
});

test("a master's student is spelled with the apostrophe (DA-77)", () => {
  assert.equal(ROLE_LABELS.masters, "Master's student");
});

test("the supervision card never says 'supervisee' (D-05)", () => {
  assert.doesNotMatch(src("features/dashboard/application/card-registry.ts"), /label: "Supervisee/);
});

test("list colour swatches have names, not hex (DA-78)", () => {
  assert.equal(LIST_COLOR_NAMES.length, LIST_COLOR_PRESETS.length);
  for (const n of LIST_COLOR_NAMES) assert.match(n, /^[A-Z][a-z ]+$/);
  assert.match(src("features/reading-lists/ui/add-list-form.tsx"), /aria-label=\{LIST_COLOR_NAMES\[i\]\}/);
  assert.equal(renderToStaticMarkup(<>{LIST_COLOR_NAMES[0]}</>), "Sage");
});

test("settings say 'on this device', not 'in this browser'", () => {
  for (const f of uiFiles(join(root, "features/settings/ui"))) {
    assert.ok(!readFileSync(f, "utf8").includes("Stored in this browser"), f);
  }
});

test("dates go through one formatter (D-01)", () => {
  const offenders = uiFiles(join(root, "features"))
    .concat(uiFiles(join(root, "components")))
    .filter((f) => /new Date\([^)]*\)\.toLocale(Date)?String\(|toLocaleDateString\(|dateStyle:/.test(readFileSync(f, "utf8")))
    .map((f) => relative(root, f).replace(/\\/g, "/"));
  // Calendar headers name a weekday or month on its own; "edited 3 Jul" is a short label.
  assert.deepEqual(offenders.filter((f) => !/logbook-screen|edited-label/.test(f)), []);
});
