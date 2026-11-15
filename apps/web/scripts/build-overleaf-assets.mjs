#!/usr/bin/env node
/**
 * Everything the Overleaf IDE needs beyond its source, which lives in the
 * `third_party/overleaf` submodule.
 *
 * Into `.overleaf-build/` (gitignored; next.config.mjs aliases to it):
 *
 * - `codemirror-autocomplete/`, `codemirror-search/`: the CodeMirror releases
 *   Overleaf pins, with the patches from its `.yarn/patches` applied.
 * - `lezer-latex/`, `lezer-bibtex/`: the LaTeX and BibTeX parsers, generated
 *   from the submodule's grammars as Overleaf's own build does.
 *
 * Into public/, the static files the IDE loads by URL:
 *
 * - `overleaf/ide.css`: Overleaf's stylesheet (`ol-host/ide.scss`), compiled
 *   with the Sass and Bootstrap the app pins. It is linked only while the IDE
 *   is mounted, so Bootstrap never styles the rest of the app.
 * - `overleaf/fonts/material-symbols/`: the icon font that stylesheet names.
 * - pdf.js's cmaps, wasm, ICC profiles, fonts and images, at the paths
 *   Overleaf's `pdf-js.ts` asks for, as Overleaf's own webpack copies them.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scopeRoots } from "./lib/overleaf-css-scope.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const overleaf = join(web, "../../third_party/overleaf");
const overleafWeb = join(overleaf, "services/web");
if (!existsSync(join(overleafWeb, "frontend"))) {
  throw new Error("third_party/overleaf is empty; run git submodule update --init --filter=blob:none");
}
const report = join(web, "src/features/report");
const out = join(web, ".overleaf-build");
const pub = join(web, "public");
const require = createRequire(import.meta.url);
const nodeModules = [join(web, "node_modules"), join(web, "../../node_modules")];
const packageDir = (name) => {
  const dir = nodeModules.map((m) => join(m, name)).find((d) => existsSync(join(d, "package.json")));
  if (!dir) throw new Error(`${name} is not installed; run npm ci`);
  return dir;
};
// The submodule may be checked out with CRLF line endings; the patches and the
// grammars are read as LF so they apply and generate the same everywhere.
const readLf = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

// `git apply` inside a work tree takes paths from its root, so each package is
// patched in a scratch directory outside any repository.
for (const [name, pkg, patch] of [
  ["codemirror-autocomplete", "codemirror-autocomplete-overleaf", "@codemirror-autocomplete-npm-6.18.4.patch"],
  ["codemirror-search", "codemirror-search-overleaf", "@codemirror-search-npm-6.5.8.patch"],
]) {
  const scratch = mkdtempSync(join(tmpdir(), `${name}-`));
  try {
    cpSync(packageDir(pkg), join(scratch, "pkg"), { recursive: true, dereference: true });
    writeFileSync(join(scratch, "fix.patch"), readLf(join(overleaf, ".yarn/patches", patch)));
    execFileSync("git", ["apply", "-p1", join(scratch, "fix.patch")], { cwd: join(scratch, "pkg"), stdio: "inherit" });
    rmSync(join(out, name), { recursive: true, force: true });
    cpSync(join(scratch, "pkg"), join(out, name), { recursive: true });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const { buildParserFile } = require("@lezer/generator");
for (const name of ["latex", "bibtex"]) {
  const dir = `lezer-${name}`;
  const grammar = readLf(join(overleafWeb, "frontend/js/features/source-editor", dir, `${name}.grammar`));
  const { parser, terms } = buildParserFile(grammar, { fileName: `${name}.grammar`, moduleStyle: "es" });
  mkdirSync(join(out, dir), { recursive: true });
  writeFileSync(join(out, dir, `${name}.mjs`), parser);
  writeFileSync(join(out, dir, `${name}.terms.mjs`), terms);
}

const sass = require("sass");
// Nested under `.ol-ide`, so the stylesheet styles only the IDE's container and
// the overlays it hands to document.body (tagged by ol-host/mount.tsx).
const { css } = sass.compileString('@use "sass:meta";\n.ol-ide { @include meta.load-css("ol-host/ide"); }', {
  loadPaths: [report, overleafWeb, ...nodeModules],
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
  join(overleafWeb, "frontend/fonts/material-symbols"),
  join(pub, "overleaf/fonts/material-symbols"),
  { recursive: true, filter: (f) => !f.endsWith(".mjs") },
);

const pdfjs = packageDir("pdfjs-dist-overleaf");
for (const [from, to] of [
  ["cmaps", "js/pdfjs-dist/cmaps"],
  ["iccs", "js/pdfjs-dist/iccs"],
  ["wasm", "js/pdfjs-dist/wasm"],
  ["standard_fonts", "fonts/pdfjs-dist"],
  ["legacy/web/images", "images/pdfjs-dist"],
]) {
  cpSync(join(pdfjs, from), join(pub, to), { recursive: true });
}
console.log(`Built the Overleaf IDE's packages, parsers, stylesheet and assets → ${out}, ${pub}`);
