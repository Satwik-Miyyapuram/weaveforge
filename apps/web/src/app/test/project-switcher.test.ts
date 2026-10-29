/**
 * The project switcher (DA-98): the keyboard lands on the current project, the
 * colour dots say what they are, and "new" and "all" are separate rows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const switcher = read("../../features/projects/ui/project-switcher.tsx");
const popover = read("../../components/popover.tsx");
const screen = read("../../features/projects/ui/projects-screen.tsx");

test("a keyboard open focuses the current project, not the first row", () => {
  assert.match(switcher, /data-autofocus=\{p\.id === current\.id \|\| undefined\}/);
  assert.match(switcher, /checked=\{p\.id === current\.id\}/);
  assert.match(popover, /querySelector<HTMLElement>\("\[data-autofocus\]"\)/);
});

test("the colour dots are named for pointers and hidden from screen readers", () => {
  const dots = switcher.match(/<span className="project-dot"[^>]*>/g) ?? [];
  assert.ok(dots.length >= 2);
  for (const dot of dots) {
    assert.match(dot, /aria-hidden/);
    assert.match(dot, /title=/);
  }
});

test("New project and All projects are two rows", () => {
  assert.doesNotMatch(switcher, /New \/ all projects/);
  assert.match(switcher, /label: "＋ New project"/);
  assert.match(switcher, /label: "All projects"/);
  assert.match(switcher, /showNewProject\(setProject\)/);
  // The projects screen opens its New project dialog when asked to.
  assert.match(screen, /export function showNewProject/);
  assert.match(screen, /useState\(\(\) => openCreateOnMount\)/);
});

test("the chip's accessible name says which project is open", () => {
  // `ariaLabel` replaces the chip's text, so a bare "Project" hid the name.
  assert.match(switcher, /ariaLabel=\{`Project: \$\{current\.name\}`\}/);
});
