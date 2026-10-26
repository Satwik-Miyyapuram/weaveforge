/** On a phone, nothing ends up under the floating bottom bar (DA-95). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("one token says how much room the bottom bar takes, safe area included", () => {
  const nav = read("../styles/nav.css");
  assert.match(nav, /--nav-clear:\s*calc\([^;]*env\(safe-area-inset-bottom/);
});

test("every screen bottom clears the bar with that token, not its own guess", () => {
  for (const file of ["shell.css", "dashboard.css", "editor-workspace.css", "reader.css"]) {
    const css = read(`../styles/${file}`);
    assert.match(css, /var\(--nav-clear\)/, `${file} does not use --nav-clear`);
    assert.doesNotMatch(css, /calc\((72|84|88|92)px \+ env\(safe-area-inset-bottom\)\)/, `${file} still guesses`);
  }
});
