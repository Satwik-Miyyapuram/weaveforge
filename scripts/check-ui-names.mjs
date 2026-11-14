#!/usr/bin/env node
/**
 * Fails when a how-to in `docs/using` names a button, tab or field the app does
 * not have. See scripts/lib/ui-names.mjs for the rules and
 * scripts/ui-names-allow.txt for names that live outside our source (other
 * apps' screens, labels the app builds from parts).
 */

import fs from "node:fs";
import path from "node:path";

import { ROOT } from "./lib/repo-stats.mjs";
import { appText, missingNames, parseAllow, stepNames } from "./lib/ui-names.mjs";

const SKIP_DIR = new Set(["node_modules", ".next", "__tests__", "target"]);

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) sourceFiles(file, out);
    } else if (/\.(tsx?|json|rs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(file);
    }
  }
  return out;
}

// Labels live in the UI and, since the port, in wf-core (e.g. enum_label.rs).
const sources = [...sourceFiles(path.join(ROOT, "apps/web/src")), ...sourceFiles(path.join(ROOT, "crates"))];
const app = appText(sources.map((file) => fs.readFileSync(file, "utf8")));
const allow = parseAllow(fs.readFileSync(path.join(ROOT, "scripts/ui-names-allow.txt"), "utf8"));
const docsDir = path.join(ROOT, "docs/using");

let failures = 0;
for (const page of fs.readdirSync(docsDir).filter((name) => name.endsWith(".md")).sort()) {
  for (const name of missingNames(stepNames(fs.readFileSync(path.join(docsDir, page), "utf8")), app, allow)) {
    console.error(`docs/using/${page}: **${name}** is not a label in apps/web/src or crates`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(
    `ui-names: ${failures} name(s) above. Fix the page to match the app, or, for another app's screen, add the name to scripts/ui-names-allow.txt.`,
  );
  process.exit(1);
}
console.log("ui-names: every name in the how-to steps is in the app");
