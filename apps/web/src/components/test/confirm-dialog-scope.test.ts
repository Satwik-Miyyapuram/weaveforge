/**
 * Rule D-07: a delete happens at once with an Undo toast. ConfirmDialog is
 * kept only for losses undo cannot reach: an account, a project, a lab,
 * leaving, or a token other apps use. A new dialog means a new entry here.
 *
 * DA-63: the dialog's question starts with the same verb as its button.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ALLOWED = [
  "components/local-api-tokens.tsx",
  "features/org/ui/org-screen.tsx",
  "features/projects/ui/projects-screen.tsx",
  "features/settings/ui/api-tokens-panel.tsx",
  "features/settings/ui/calendar-feed-panel.tsx",
  "features/settings/ui/mcp-tokens-panel.tsx",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "test" && name !== "node_modules") walk(full, out);
    } else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

const users = () =>
  walk(src)
    .map((f) => path.relative(src, f).replaceAll("\\", "/"))
    .filter((rel) => readFileSync(path.join(src, rel), "utf8").includes("<ConfirmDialog"))
    .sort();

/** First words of each string in a `title=` / `confirmLabel=` prop, quotes or ternary branches. */
export function propVerbs(text: string, prop: string): string[] {
  const verbs: string[] = [];
  for (const m of text.matchAll(new RegExp(`\\b${prop}=(?:"([^"]*)"|\\{([^\\n]*)\\})`, "g"))) {
    if (m[1] !== undefined) verbs.push((m[1].split(/\s/)[0] ?? "").toLowerCase());
    // In an expression, a branch string starts the prop or follows `?` / `:`.
    else for (const w of (m[2] ?? "").matchAll(/(?:^|[?:])\s*["`](\w+)/g)) verbs.push((w[1] ?? "").toLowerCase());
  }
  return verbs;
}

test("only the confirm-list screens draw a ConfirmDialog", () => {
  assert.deepEqual(users(), [...ALLOWED].sort());
});

test("propVerbs reads plain, template and ternary props", () => {
  assert.deepEqual(propVerbs(`title="Leave lab?"`, "title"), ["leave"]);
  assert.deepEqual(propVerbs("title={`Delete \"${x}\"?`}", "title"), ["delete"]);
  assert.deepEqual(propVerbs(`confirmLabel={a ? "Make new link" : "Turn off"}`, "confirmLabel"), ["make", "turn"]);
});

test("each dialog asks with the verb its button uses (DA-63)", () => {
  for (const rel of ALLOWED) {
    const text = readFileSync(path.join(src, rel), "utf8");
    const titles = propVerbs(text.slice(text.indexOf("<ConfirmDialog")), "title");
    const labels = propVerbs(text.slice(text.indexOf("<ConfirmDialog")), "confirmLabel");
    assert.ok(labels.length > 0, rel);
    assert.deepEqual(titles.slice(0, labels.length), labels, rel);
  }
});
