/**
 * `<Button>` defaults to `type="button"` (design D02), so a form's submit
 * Button must say `type="submit"`. A Button with neither an `onClick` nor a
 * `type` does nothing: a click and Enter both fall through. This shipped once
 * for every add form, so the scan guards all of them.
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

/** The attribute text of each `<Button ...>` opening tag; `{...}` may hold `>`. */
export function buttonTags(text: string): string[] {
  const tags: string[] = [];
  const re = /<Button\b/g;
  for (const m of text.matchAll(re)) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    tags.push(text.slice(m.index + m[0].length, i));
  }
  return tags;
}

/** True when a Button tag can never act: no click handler, no type, no link, no spread. */
export function isInert(attrs: string): boolean {
  return !/\bonClick=|\btype=|\bhref=|\{\s*\.\.\./.test(attrs);
}

test("buttonTags reads multi-line tags with arrows inside braces", () => {
  const tags = buttonTags(`<Button\n  variant="primary"\n  onClick={() => go(a > b)}\n>Go</Button><Button disabled={x}>S</Button>`);
  assert.equal(tags.length, 2);
  assert.match(tags[0]!, /onClick/);
  assert.equal(tags[1]!.trim(), "disabled={x}");
});

test("isInert flags a Button with no onClick and no type", () => {
  assert.equal(isInert(' variant="primary" disabled={busy}'), true);
  assert.equal(isInert(' type="submit" disabled={busy}'), false);
  assert.equal(isInert(" onClick={save}"), false);
  assert.equal(isInert(" {...props}"), false);
  assert.equal(isInert(' href="/settings"'), false);
});

test("every Button in the app either submits or handles a click", () => {
  const inert: string[] = [];
  for (const file of tsxFiles(src)) {
    const text = readFileSync(file, "utf8");
    for (const attrs of buttonTags(text)) {
      if (isInert(attrs)) inert.push(`${path.relative(src, file)}: <Button${attrs.replace(/\s+/g, " ")}>`);
    }
  }
  assert.deepEqual(inert, []);
});
