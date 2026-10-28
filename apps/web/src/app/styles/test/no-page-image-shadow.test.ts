/**
 * Pages and the images on them sit flat: no drop shadow on a note's sheet, a
 * figure placed on it, or an image thumbnail on a paper or experiment. Popovers
 * and menus that float over a page keep theirs.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sheets = ["styles", "themes"].flatMap((dir) =>
  readdirSync(path.join(app, dir))
    .filter((f) => f.endsWith(".css"))
    .map((f) => ({
      file: `${dir}/${f}`,
      css: readFileSync(path.join(app, dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""),
    })),
);

// Each selector names a page or an image; `(?![\w-])` keeps .ink-figure-popover out.
const FLAT = [".ink-sheet", ".ink-figure", ".artifact-thumbs a", ".image-thumb", ".card-thumb"];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

for (const target of FLAT) {
  test(`${target} has no drop shadow`, () => {
    const hit = new RegExp(`${esc(target)}(?![\\w-])`);
    const offenders: string[] = [];
    for (const { file, css } of sheets) {
      for (const [, sel = "", body = ""] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!hit.test(sel)) continue;
        const shadow = body.match(/(?:^|[;\s])box-shadow\s*:\s*([^;]+)/)?.[1]?.trim();
        if (shadow && shadow !== "none") offenders.push(`${file}: ${sel.trim().slice(0, 80)} → ${shadow}`);
      }
    }
    assert.deepEqual(offenders, []);
  });
}
