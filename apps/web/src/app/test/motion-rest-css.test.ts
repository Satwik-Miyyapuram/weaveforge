/** Motion never leaves a card looking disabled (design D04). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const motion = readFileSync(fileURLToPath(new URL("../styles/motion.css", import.meta.url)), "utf8");

function block(name: string): string {
  const i = motion.indexOf(`@keyframes ${name} {`);
  assert.ok(i >= 0, `missing keyframes ${name}`);
  return motion.slice(i, motion.indexOf("}", motion.indexOf("{", i) + 1));
}

test("the scroll-driven rise does not fade, so a card at the screen edge rests at opacity 1 (DA-20)", () => {
  // A view timeline holds its progress while the card sits still; any opacity
  // in it leaves the bottom card half faded until the user scrolls.
  assert.doesNotMatch(block("reactive-rise"), /opacity/);
  assert.match(block("reactive-rise"), /translate:/);
});

test("the rise only runs when the OS allows motion (DA-20)", () => {
  const i = motion.indexOf("@keyframes reactive-rise {");
  const media = motion.lastIndexOf("@media", i);
  assert.match(motion.slice(media, i), /^@media \(prefers-reduced-motion: no-preference\)/);
});

test("the card glow hides while a menu on the card is open (DA-21)", () => {
  assert.match(motion, /\):has\(\[aria-expanded="true"\]\)::after \{\s*opacity: 0;/);
});
