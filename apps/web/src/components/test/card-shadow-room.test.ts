/**
 * Card shadows (and the theme's tilt) reach past the card box. A clip on the
 * card grid or the Papers screen cut the right-hand column's shadow flat at the
 * screen edge. The app shell already clips at the window, inside its gutter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = (name: string) => readFileSync(fileURLToPath(new URL(`../../app/styles/${name}`, import.meta.url)), "utf8");

/** Declarations of every top-level rule whose selector list is exactly `selector`. */
function rules(src: string, selector: string): string[] {
  return src
    .split("}")
    .map((chunk) => chunk.split("{"))
    .flatMap(([head, body]) => (body !== undefined && head?.trim().split("\n").pop()?.trim() === selector ? [body] : []));
}

for (const [file, selector] of [["entity-cards.css", ".card-columns"], ["papers.css", ".papers-screen"]] as const) {
  test(`${selector} leaves room for the card shadows`, () => {
    const found = rules(css(file), selector);
    assert.ok(found.length > 0, `${selector} rule not found in ${file}`);
    for (const body of found) assert.doesNotMatch(body, /overflow(-x)?\s*:\s*(clip|hidden)/);
  });
}

test("the app shell still clips at the window, so nothing scrolls sideways", () => {
  assert.match(rules(css("shell.css"), ".app-shell").join(""), /overflow-x:\s*clip/);
});
