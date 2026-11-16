import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The CRT look is flat: no tilt on the pitch, the stage objects or the deck. */

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), "utf8");

test("the CRT look sets --tilt to 0deg", () => {
  const block = read("looks.css").match(/\.wf-looks\[data-look="crt"\] \{[\s\S]*?\n\}/)?.[0];
  assert.ok(block, "CRT look block is missing");
  assert.match(block, /--tilt:\s*0deg/);
  assert.doesNotMatch(block, /--tilt:\s*-?[1-9]/);
});

test("the deck does not rotate its cards in the CRT look", () => {
  const page = read("page.tsx");
  assert.match(page, /theme === "crt" \? "none" : `rotate\(\$\{c\.rot\}deg\)`/);
});
