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

test("the card rise does not fade, so a card never rests looking disabled (DA-20)", () => {
  assert.doesNotMatch(block("reactive-rise"), /opacity/);
  assert.match(block("reactive-rise"), /translate:/);
});

test("the card rise ends and lets go of its layer (.agents/ui-layers.md)", () => {
  // A view timeline never finishes, so every card kept its own composited
  // layer for as long as it was on screen (19 layers on the dashboard).
  assert.doesNotMatch(motion, /animation-timeline:\s*view\(/);
  assert.match(motion, /animation: reactive-rise var\(--rm-slow\) var\(--layout-ease\) backwards;/);
});

test("dashboard entrances fill backwards, so a finished fade drops its layer (.agents/ui-layers.md)", () => {
  const dashboard = readFileSync(fileURLToPath(new URL("../styles/dashboard.css", import.meta.url)), "utf8");
  assert.match(dashboard, /dashboard-card-fade-in [^;]*backwards;/);
  assert.match(dashboard, /dashboard-content-in [^;]*backwards;/);
  assert.doesNotMatch(dashboard, /dashboard-(card-fade-in|content-in) [^;]*\bboth;/);
});

test("list and graph entrances fill backwards, so the graph drops its layer (.agents/ui-layers.md)", () => {
  // `both` kept the finished fade in effect: the graph stayed composited and its bar and the nav overlapped it (9 layers).
  const base = readFileSync(fileURLToPath(new URL("../styles/base.css", import.meta.url)), "utf8");
  assert.match(base, /animation: content-in [^;]*backwards;/);
  assert.doesNotMatch(base, /animation: content-in [^;]*\bboth;/);
});

test("the rise only runs when the OS allows motion (DA-20)", () => {
  const i = motion.indexOf("@keyframes reactive-rise {");
  const media = motion.lastIndexOf("@media", i);
  assert.match(motion.slice(media, i), /^@media \(prefers-reduced-motion: no-preference\)/);
});

test("the card glow hides while a menu on the card is open (DA-21)", () => {
  assert.match(motion, /\):has\(\[aria-expanded="true"\]\)::after \{\s*opacity: 0;/);
});
