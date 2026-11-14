#!/usr/bin/env node
/**
 * The architecture map, with its line numbers read off the repository.
 *
 * The journeys are written by hand in `docs/map/journeys.mjs`: which calls a
 * user's action goes through, and which doc explains it. What goes stale is the
 * line each call sits on, so this checks every reference against the source and
 * stamps the current line into `docs/map/data.js`, which the map page loads.
 *
 *   node scripts/build-map.mjs            validate, then rewrite docs/map/data.js
 *   node scripts/build-map.mjs --check    validate only; writes nothing
 *
 * Either mode exits 1 and lists every problem when a reference does not resolve.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JOURNEYS = "docs/map/journeys.mjs";
const OUT = "docs/map/data.js";
const LAYERS = ["ui", "hook", "service", "bridge", "core", "storage", "network"];
const FALLBACK_REPO = "https://github.com/Satwik-Miyyapuram/weaveforge";

/** 1-based line of the first line containing `sym`; the one nearest `hint` when several do. */
export function resolveLine(text, sym, hint) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes(sym)) hits.push(i + 1);
  });
  if (hits.length === 0) return null;
  if (hint === undefined || hint === null) return hits[0];
  return hits.reduce((best, line) => (Math.abs(line - hint) < Math.abs(best - hint) ? line : best));
}

/** True when some line is a markdown heading whose text is exactly `heading`. */
export function headingExists(markdown, heading) {
  return markdown.split(/\r?\n/).some((line) => {
    const match = line.trim().match(/^#{1,6} (.+)$/);
    return match !== null && match[1].trim() === heading;
  });
}

/** Every problem with the journeys, as one message per line. Empty when they all resolve. */
export function validate(areas, { readFile, exists, labelExists }) {
  const errors = [];
  for (const area of areas) {
    for (const doc of area.docs ?? []) {
      if (!exists(doc.path)) errors.push(`${area.id} doc: ${doc.path} not found`);
    }

    const journeys = area.journeys ?? [];
    const seen = new Set();
    for (const journey of journeys) {
      if (seen.has(journey.id)) errors.push(`${area.id}: duplicate journey id "${journey.id}"`);
      seen.add(journey.id);
    }

    if (area.stages) {
      for (const stage of area.stages) {
        for (const id of stage.journeys) {
          if (!seen.has(id)) errors.push(`${area.id} stage "${stage.name}": unknown journey "${id}"`);
        }
      }
      for (const journey of journeys) {
        const count = area.stages.filter((stage) => stage.journeys.includes(journey.id)).length;
        if (count !== 1) errors.push(`${journey.id}: in ${count} stages, expected exactly one`);
      }
    }

    for (const journey of journeys) {
      validateJourney(journey, { readFile, exists, labelExists }, errors);
    }
  }
  return errors;
}

function validateJourney(journey, { readFile, exists, labelExists }, errors) {
  const id = journey.id;
  const chain = journey.chain ?? [];
  const calls = new Set();

  for (const hop of chain) {
    if (!LAYERS.includes(hop.layer)) errors.push(`${id} hop ${hop.n}: bad layer "${hop.layer}"`);
    if (calls.has(hop.n)) errors.push(`${id} hop ${hop.n}: duplicate n`);
    calls.add(hop.n);
  }

  for (const hop of chain) {
    if (hop.by !== undefined && !calls.has(hop.by)) errors.push(`${id} hop ${hop.n}: by ${hop.by} not in chain`);
    if (!exists(hop.path)) {
      errors.push(`${id} hop ${hop.n}: ${hop.path} not found`);
    } else if (resolveLine(readFile(hop.path), hop.sym, hop.line) === null) {
      errors.push(`${id} hop ${hop.n}: "${hop.sym}" not found in ${hop.path}`);
    }
  }

  (journey.steps ?? []).forEach((step, i) => {
    for (const n of step.hops ?? []) {
      if (!calls.has(n)) errors.push(`${id} step ${i + 1}: hop ${n} not in chain`);
    }
    const label = typeof step.ui === "string" ? step.ui : step.ui?.verb === "Click" ? step.ui.label : null;
    if (label !== null && label !== undefined && !labelExists(label)) {
      errors.push(`${id} step ${i + 1}: UI label "${label}" not found in apps/web/src`);
    }
  });

  for (const debug of journey.debug ?? []) {
    if (!calls.has(debug.check)) errors.push(`${id} debug: check ${debug.check} not in chain`);
  }

  if (journey.help) {
    const { path: file, heading } = journey.help;
    if (!exists(file)) {
      errors.push(`${id} help: ${file} not found`);
    } else if (!headingExists(readFile(file), heading)) {
      errors.push(`${id} help: heading "${heading}" not found in ${file}`);
    }
  }
}

/** The MAP object: hops get their current `line`, lose `sym`; journeys get `checked`. */
export function build(areas, { readFile, ref, repo }) {
  const copy = JSON.parse(JSON.stringify(areas));
  for (const area of copy) {
    for (const journey of area.journeys ?? []) {
      journey.checked = ref;
      journey.chain = (journey.chain ?? []).map(({ sym, ...hop }) => ({
        ...hop,
        line: resolveLine(readFile(hop.path), sym, hop.line),
      }));
    }
  }
  return { repo, ref, areas: copy };
}

let labelSource = null;

/** Whether `label` appears in the web or core source. The text is read once and kept. */
export function labelExists(label) {
  if (labelSource === null) {
    const files = [
      ...sourceFiles("apps/web/src", [".ts", ".tsx"]),
      ...sourceFiles("crates/wf-core/src", [".rs"]),
    ];
    labelSource = files.map((file) => readFileSync(file, "utf8")).join("\n");
  }
  return labelSource.includes(label);
}

function sourceFiles(dir, exts, found = []) {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return found;
  for (const entry of readdirSync(abs)) {
    if (entry === "node_modules") continue;
    const full = path.join(abs, entry);
    const rel = path.relative(ROOT, full).split(path.sep).join("/");
    if (statSync(full).isDirectory()) {
      if (rel.endsWith("features/report/vendor")) continue;
      sourceFiles(rel, exts, found);
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

function readRepo(file) {
  return readFileSync(path.join(ROOT, file), "utf8");
}

function existsRepo(file) {
  return existsSync(path.join(ROOT, file));
}

function gitRef() {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function repoUrl() {
  let remote;
  try {
    remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return FALLBACK_REPO;
  }
  const match = remote.replace(/\.git$/, "").match(/github\.com[:/]([^/]+\/[^/]+)$/);
  return match ? `https://github.com/${match[1]}` : FALLBACK_REPO;
}

async function main(argv) {
  const mod = await import(pathToFileURL(path.join(ROOT, JOURNEYS)).href);
  const areas = mod.default.areas;
  const errors = validate(areas, { readFile: readRepo, exists: existsRepo, labelExists });
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  if (argv.includes("--check")) {
    console.log("map: ok");
    return;
  }

  const map = build(areas, { readFile: readRepo, ref: gitRef(), repo: repoUrl() });
  writeFileSync(
    path.join(ROOT, OUT),
    `// Generated by scripts/build-map.mjs from docs/map/journeys.mjs. Do not edit.\nwindow.MAP = ${JSON.stringify(map, null, 1)};\n`,
  );
  const journeys = areas.reduce((sum, area) => sum + (area.journeys ?? []).length, 0);
  const calls = map.areas.reduce(
    (sum, area) => sum + (area.journeys ?? []).reduce((s, journey) => s + journey.chain.length, 0),
    0,
  );
  console.log(`map: ${areas.length} areas, ${journeys} journeys, ${calls} calls`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
