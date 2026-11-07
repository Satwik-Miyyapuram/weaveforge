#!/usr/bin/env node
/**
 * Static files the vendored Overleaf IDE loads by URL, written into public/:
 *
 * - `overleaf/ide.css`: Overleaf's stylesheet (`ol-host/ide.scss`), compiled
 *   with the Sass and Bootstrap the vendored tree pins. It is linked only while
 *   the IDE is mounted, so Bootstrap never styles the rest of the app.
 * - `overleaf/fonts/material-symbols/`: the icon font that stylesheet names.
 * - pdf.js's cmaps, wasm, ICC profiles, fonts and images, at the paths
 *   Overleaf's `pdf-js.ts` asks for, as Overleaf's own webpack copies them.
 */
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scopeRoots } from "./lib/overleaf-css-scope.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(web, "src/features/report/vendor/overleaf");
const modules = join(vendor, "node_modules");
const pub = join(web, "public");
const require = createRequire(join(modules, "noop.js"));

const sass = require("sass");
// Nested under `.ol-ide`, so the stylesheet styles only the IDE's container and
// the overlays it hands to document.body (tagged by ol-host/mount.tsx).
const { css } = sass.compileString('@use "sass:meta";\n.ol-ide { @include meta.load-css("ol-host/ide"); }', {
  loadPaths: [vendor, modules],
  style: "compressed",
  quietDeps: true,
  logger: sass.Logger.silent,
});
mkdirSync(join(pub, "overleaf"), { recursive: true });
writeFileSync(
  join(pub, "overleaf/ide.css"),
  // Sass marks non-ASCII output with a BOM; the charset rule says it instead,
  // since a BOM may only come first and the font import must precede the rules.
  `@charset "UTF-8";\n@import url("fonts/material-symbols/material-symbols.css");\n${scopeRoots(css.replace(/^\uFEFF/, ""))}`,
);
cpSync(
  join(vendor, "frontend/fonts/material-symbols"),
  join(pub, "overleaf/fonts/material-symbols"),
  { recursive: true, filter: (f) => !f.endsWith(".mjs") },
);

const pdfjs = join(modules, "pdfjs-dist-overleaf");
for (const [from, to] of [
  ["cmaps", "js/pdfjs-dist/cmaps"],
  ["iccs", "js/pdfjs-dist/iccs"],
  ["wasm", "js/pdfjs-dist/wasm"],
  ["standard_fonts", "fonts/pdfjs-dist"],
  ["legacy/web/images", "images/pdfjs-dist"],
]) {
  cpSync(join(pdfjs, from), join(pub, to), { recursive: true });
}
console.log(`Built the Overleaf IDE's stylesheet and assets → ${pub}`);
