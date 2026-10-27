/** No screen shows the browser's own "Choose files / No file chosen" picker: no theme can restyle it. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "test" ? [] : sources(p);
    return /\.tsx$/.test(p) ? [p] : [];
  });
}

/** Every `<input … type="file" … />` element in a source file. */
export function fileInputs(src: string): string[] {
  // No "<" inside: a prose `<input type="file">` in a comment is not an element.
  return [...src.matchAll(/<input\b[^<]*?\/>/g)].map((m) => m[0]).filter((el) => /type="file"/.test(el));
}

/** Hidden outright, or kept for screen readers behind a real button. */
export function isHidden(el: string): boolean {
  return /\shidden(\s|\/|=\{true\})/.test(el) || /className="[^"]*\bsr-only\b/.test(el);
}

test("the element finder sees a visible picker and passes a hidden one", () => {
  assert.deepEqual(fileInputs(`<input id="a" type="file" />`).map(isHidden), [false]);
  assert.deepEqual(fileInputs(`<input\n  type="file"\n  hidden\n  onChange={(e) => go(e)}\n/>`).map(isHidden), [true]);
  assert.deepEqual(fileInputs(`<input className="sr-only" type="file" />`).map(isHidden), [true]);
  assert.deepEqual(fileInputs(`<input type="text" />`), []);
  assert.deepEqual(fileInputs("/** a `<input type=\"file\">` */\n<Icon />"), []);
});

test("no screen shows the native file picker", () => {
  const offenders = sources(root).flatMap((f) =>
    fileInputs(readFileSync(f, "utf8"))
      .filter((el) => !isHidden(el))
      .map(() => relative(root, f).replace(/\\/g, "/")),
  );
  assert.deepEqual(offenders, []);
});
