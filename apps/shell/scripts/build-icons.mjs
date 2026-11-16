// Generates the Tauri shell icons from the emblem source:
//   apps/web/public/icons/weave_forge.svg  ->  apps/shell/icons/icon.ico (16-256) and icon.png (512)
//
// The emblem has no tile, so the output is transparent. Each size is rendered by
// headless Edge with a transparent page background. The ink colour is fixed here
// (an .ico cannot follow the OS theme), chosen to stay readable on both light and
// dark taskbars. Override with --ink <#hex>.
//
// Usage: node apps/shell/scripts/build-icons.mjs [--ink #6B7A90]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..");
const source = path.join(repo, "apps", "web", "public", "icons", "weave_forge.svg");
const outDir = path.join(here, "..", "icons");

const DEFAULT_INK = "#6B7A90"; // mid-tone: about 4.4:1 against both #000 and #fff
const ACCENT = "#4B6FA5";
const ICO_SIZES = [16, 24, 32, 48, 64, 256];
const PNG_SIZE = 512;

const argInk = process.argv.indexOf("--ink");
const ink = argInk > -1 ? process.argv[argInk + 1] : DEFAULT_INK;
if (!/^#[0-9a-fA-F]{6}$/.test(ink)) throw new Error(`--ink must be #rrggbb, got ${ink}`);

const edge = process.env.EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

// Fixed colours for a raster: replace the CSS variables with literal values and drop
// the OS-theme block, so the render does not depend on the machine's colour scheme.
function flatSvg(svg, size) {
  const flat = svg
    .replace(/@media \(prefers-color-scheme: dark\)\s*\{[\s\S]*?\n\s*\}/, "")
    .replace(/var\(--logo-ink, [^)]*\)/g, ink)
    .replace(/var\(--logo-accent, [^)]*\)/g, ACCENT)
    .replace(/<svg ([^>]*)width="100%" height="100%"/, `<svg $1width="${size}" height="${size}"`);
  if (/var\(--/.test(flat)) throw new Error("unresolved CSS variable in the emblem");
  return flat;
}

// Renders the emblem at `size` px with a transparent background and returns PNG bytes.
function renderPng(svg, size, dir) {
  const html = path.join(dir, `emblem-${size}.html`);
  const png = path.join(dir, `emblem-${size}.png`);
  fs.writeFileSync(
    html,
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style></head>` +
      `<body>${flatSvg(svg, size)}</body></html>`,
  );
  execFileSync(edge, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--default-background-color=00000000",
    `--window-size=${size},${size}`,
    `--screenshot=${png}`,
    "file:///" + html.replace(/\\/g, "/"),
  ], { stdio: "ignore", timeout: 60_000 });
  return fs.readFileSync(png);
}

// ICO: ICONDIR, one 16-byte ICONDIRENTRY per image, then the PNG payloads.
function buildIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const o = 6 + 16 * i;
    header[o] = size === 256 ? 0 : size;
    header[o + 1] = size === 256 ? 0 : size;
    header[o + 2] = 0;
    header[o + 3] = 0;
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(png.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

const svg = fs.readFileSync(source, "utf8");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-icons-"));
try {
  const ico = buildIco(ICO_SIZES.map((size) => ({ size, png: renderPng(svg, size, dir) })));
  fs.writeFileSync(path.join(outDir, "icon.ico"), ico);
  fs.writeFileSync(path.join(outDir, "icon.png"), renderPng(svg, PNG_SIZE, dir));
  console.log(`wrote icon.ico (${ICO_SIZES.join(", ")}) and icon.png (${PNG_SIZE}) with ink ${ink}`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
