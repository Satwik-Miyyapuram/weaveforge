/**
 * The running window icon's colours (desktop only). The icon must stay visible
 * on the taskbar: each colour must reach 3:1 against the taskbar background,
 * otherwise the static colour for that OS mode is used instead.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MIN_CONTRAST,
  STATIC_COLOURS,
  TASKBAR_BACKGROUND,
  contrast,
  parseColour,
  pickWindowIconColours,
} from "../window-icon-colours";

const here = path.dirname(fileURLToPath(import.meta.url));
const themesDir = path.resolve(here, "..", "..", "..", "app", "themes");

test("parseColour reads hex and rgb() computed values, and rejects anything else", () => {
  assert.equal(parseColour("#2B222B"), "#2b222b");
  assert.equal(parseColour("rgb(43, 34, 43)"), "#2b222b");
  assert.equal(parseColour("rgba(43, 34, 43, 1)"), "#2b222b");
  assert.equal(parseColour(""), null);
  assert.equal(parseColour(null), null);
  assert.equal(parseColour("var(--accent)"), null);
  assert.equal(parseColour("oklch(0.5 0.1 200)"), null);
});

test("contrast uses the WCAG luminance ratio", () => {
  assert.ok(Math.abs(contrast("#000000", "#ffffff") - 21) < 0.01);
  assert.ok(contrast("#1f6dab", "#f3f3f3") >= MIN_CONTRAST);
});

test("the static colours for each OS mode reach the contrast floor on their taskbar", () => {
  for (const mode of ["light", "dark"] as const) {
    const bg = TASKBAR_BACKGROUND[mode];
    assert.ok(contrast(STATIC_COLOURS[mode].ink, bg) >= MIN_CONTRAST, `${mode} ink fails on ${bg}`);
    assert.ok(contrast(STATIC_COLOURS[mode].dot, bg) >= MIN_CONTRAST, `${mode} dot fails on ${bg}`);
  }
});

test("a theme colour that reads on the taskbar is used as is", () => {
  assert.deepEqual(pickWindowIconColours({ ink: "#1f6dab", dot: "#2b222b" }, "light"), {
    ink: "#1f6dab",
    dot: "#2b222b",
  });
  assert.deepEqual(pickWindowIconColours({ ink: "#89b4fa", dot: "#cdd6f4" }, "dark"), {
    ink: "#89b4fa",
    dot: "#cdd6f4",
  });
});

test("an ink that fails 3:1 on a light taskbar falls back to the static light ink", () => {
  // brutal: marigold accent on the light taskbar is about 1.7:1.
  const picked = pickWindowIconColours({ ink: "#ffc536", dot: "#12110f" }, "light");
  assert.equal(picked.ink, STATIC_COLOURS.light.ink);
  assert.equal(picked.dot, "#12110f");
});

test("an ink that fails on a dark taskbar falls back to the static dark ink", () => {
  const picked = pickWindowIconColours({ ink: "#3b5b8c", dot: "#e7ebf1" }, "dark");
  assert.equal(picked.ink, STATIC_COLOURS.dark.ink);
  assert.equal(picked.dot, "#e7ebf1");
});

test("a missing or unreadable theme colour uses the static colour for the mode", () => {
  assert.deepEqual(pickWindowIconColours({ ink: null, dot: "" }, "dark"), STATIC_COLOURS.dark);
  assert.deepEqual(pickWindowIconColours({ ink: "var(--x)", dot: null }, "light"), STATIC_COLOURS.light);
});

// Every theme in apps/web/src/app/themes is checked against both taskbars, so a new
// theme with a low-contrast accent cannot ship a window icon that disappears.
function themeTokens(file: string): { accent: string | null; text: string | null } {
  const css = fs.readFileSync(path.join(themesDir, file), "utf8");
  const read = (name: string) => {
    const m = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
    const value = m?.[1];
    return value ? value.trim() : null;
  };
  return { accent: parseColour(read("accent")), text: parseColour(read("text")) };
}

test("every theme gets an icon that reads on both taskbars", () => {
  const files = fs.readdirSync(themesDir).filter((f) => f.endsWith(".css") && f !== "index.css" && f !== "common.css");
  assert.ok(files.length >= 17, `expected the 17 themes, found ${files.length}`);
  for (const file of files) {
    const { accent, text } = themeTokens(file);
    assert.ok(accent && text, `${file} has no literal --accent and --text`);
    for (const mode of ["light", "dark"] as const) {
      const { ink, dot } = pickWindowIconColours({ ink: accent, dot: text }, mode);
      const bg = TASKBAR_BACKGROUND[mode];
      assert.ok(contrast(ink, bg) >= MIN_CONTRAST, `${file} ${mode}: ink ${ink} fails on ${bg}`);
      assert.ok(contrast(dot, bg) >= MIN_CONTRAST, `${file} ${mode}: dot ${dot} fails on ${bg}`);
    }
  }
});
