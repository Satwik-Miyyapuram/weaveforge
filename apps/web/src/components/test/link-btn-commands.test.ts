/**
 * A link-styled button opens something; a command looks like a button (design
 * D02, DA-12). "Edit", "Revoke" or "Copy" drawn as underlined text reads as
 * navigation, so a reader cannot tell it will change anything.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "test" ? [] : tsxFiles(full);
    return name.endsWith(".tsx") ? [full] : [];
  });
}

const COMMAND =
  /^(Edit|Delete|Remove|Revoke|Unlink|Confirm|Cancel|Refresh|Run|Re-run|Copy|Clear|Select|Add|Disable|Resolve|Reopen|Reply|Save|Set|Dismiss|Retry|Reset)\b/i;

/** Visible text of a JSX body, good enough for its first word. */
function firstWords(body: string): string {
  return body
    .replace(/<[^>]*>/g, " ")
    .replace(/\{[^{}]*\?\s*"([^"]*)"[^{}]*\}/g, " $1 ")
    .replace(/[{}"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function linkStyledCommands(text: string): string[] {
  const hits: string[] = [];
  const re = /<button\b((?:[^<>=]|=(?:>|(?!>))|<(?:=|(?!=))|>=)*)>([\s\S]*?)<\/button>/g;
  for (const m of text.matchAll(re)) {
    if (!/className=[{"`][^>]*\blink-btn\b/.test(m[1] ?? "")) continue;
    const words = firstWords(m[2] ?? "");
    if (COMMAND.test(words)) hits.push(words.slice(0, 40));
  }
  return hits;
}

test("the scanner flags a command and passes a navigation link", () => {
  assert.deepEqual(linkStyledCommands('<button type="button" className="link-btn" onClick={() => edit()}>Edit</button>'), ["Edit"]);
  assert.deepEqual(linkStyledCommands('<button className="link-btn" onClick={() => open(p)}>{p.title}</button>'), []);
  assert.deepEqual(linkStyledCommands('<Button variant="ghost" size="sm">Edit</Button>'), []);
});

test("no command in the app is drawn as a link", () => {
  const found = tsxFiles(src).flatMap((file) =>
    linkStyledCommands(readFileSync(file, "utf8")).map((w) => `${path.relative(src, file)}: ${w}`),
  );
  assert.deepEqual(found, []);
});
