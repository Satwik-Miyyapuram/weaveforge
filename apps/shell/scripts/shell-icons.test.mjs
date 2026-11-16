import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { test } from "node:test";

// The taskbar and window icon must read on light and dark taskbars. These tests
// check the generated icons (apps/shell/icons) against that, and check that the
// emblem source has no tile behind it.

const shell = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(shell, "..", "..");
const conf = JSON.parse(fs.readFileSync(path.join(shell, "tauri.conf.json"), "utf8"));

const REQUIRED_SIZES = [16, 24, 32, 48, 64, 256];
const MIN_OPAQUE_SHARE = 0.03; // share of pixels that are inked (alpha >= 128)
const MAX_OPAQUE_SHARE = 0.5; // above this the icon is a tile, not an emblem
const MIN_CONTRAST = 3; // WCAG 2.x non-text contrast for graphical objects

// ICO: ICONDIR (6 bytes) then 16-byte ICONDIRENTRY records. A width/height byte of 0 means 256.
function icoEntries(buf) {
  assert.equal(buf.readUInt16LE(2), 1, "icon.ico is not an ICO file");
  const count = buf.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const o = 6 + 16 * i;
    const size = buf.readUInt32LE(o + 8);
    const offset = buf.readUInt32LE(o + 12);
    out.push({
      width: buf[o] || 256,
      height: buf[o + 1] || 256,
      png: buf.subarray(offset, offset + size),
    });
  }
  return out;
}

// Decodes an 8-bit RGBA PNG (all filter types) into a flat RGBA buffer.
function decodePng(buf) {
  assert.equal(buf.readUInt32BE(0), 0x89504e47, "not a PNG");
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colour = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    }
    off += 12 + len;
  }
  assert.equal(depth, 8, "PNG must be 8-bit");
  assert.equal(colour, 6, "PNG must be RGBA");
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const cur = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      const pred = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      assert.notEqual(pred, undefined, `unknown PNG filter ${filter}`);
      out[y * stride + x] = (cur + pred) & 0xff;
    }
  }
  return { width, height, rgba: out };
}

function luminance([r, g, b]) {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Measures one decoded icon: corners, inked share, and the mean ink colour.
function measure({ width, height, rgba }) {
  const alphaAt = (x, y) => rgba[(y * width + x) * 4 + 3];
  const corners = [alphaAt(0, 0), alphaAt(width - 1, 0), alphaAt(0, height - 1), alphaAt(width - 1, height - 1)];
  let inked = 0;
  const sum = [0, 0, 0];
  for (let i = 0; i < width * height; i += 1) {
    if (rgba[i * 4 + 3] >= 128) {
      inked += 1;
      sum[0] += rgba[i * 4];
      sum[1] += rgba[i * 4 + 1];
      sum[2] += rgba[i * 4 + 2];
    }
  }
  const mean = inked ? sum.map((v) => v / inked) : [0, 0, 0];
  return { corners, opaqueShare: inked / (width * height), ink: mean };
}

const icoPath = path.join(shell, "icons", "icon.ico");

test("icon.ico carries every required size", () => {
  const sizes = icoEntries(fs.readFileSync(icoPath))
    .map((e) => e.width)
    .sort((a, b) => a - b);
  assert.deepEqual(sizes, REQUIRED_SIZES);
  for (const e of icoEntries(fs.readFileSync(icoPath))) {
    assert.equal(e.width, e.height, `${e.width}x${e.height} entry is not square`);
  }
});

test("every icon.ico size has real, transparent-cornered emblem coverage that reads on black and white", () => {
  for (const entry of icoEntries(fs.readFileSync(icoPath))) {
    const { width, corners, opaqueShare, ink } = measure(decodePng(entry.png));
    const label = `${width}px`;
    assert.deepEqual(corners, [0, 0, 0, 0], `${label} has an opaque corner: a tile is behind the emblem`);
    assert.ok(opaqueShare >= MIN_OPAQUE_SHARE, `${label} inked share ${opaqueShare.toFixed(3)} is below ${MIN_OPAQUE_SHARE}`);
    assert.ok(opaqueShare <= MAX_OPAQUE_SHARE, `${label} inked share ${opaqueShare.toFixed(3)} is above ${MAX_OPAQUE_SHARE}: a tile covers the emblem`);
    const onBlack = contrast(ink, [0, 0, 0]);
    const onWhite = contrast(ink, [255, 255, 255]);
    assert.ok(onBlack >= MIN_CONTRAST, `${label} ink contrast on #000 is ${onBlack.toFixed(2)}, need ${MIN_CONTRAST}`);
    assert.ok(onWhite >= MIN_CONTRAST, `${label} ink contrast on #fff is ${onWhite.toFixed(2)}, need ${MIN_CONTRAST}`);
  }
});

test("icon.png is the 512px transparent emblem", () => {
  const png = decodePng(fs.readFileSync(path.join(shell, "icons", "icon.png")));
  assert.equal(png.width, 512);
  assert.equal(png.height, 512);
  assert.deepEqual(measure(png).corners, [0, 0, 0, 0]);
});

test("every icon path in tauri.conf.json exists", () => {
  assert.ok(conf.bundle.icon.length > 0);
  for (const rel of conf.bundle.icon) {
    assert.ok(fs.existsSync(path.join(shell, rel)), `bundle.icon -> ${rel} is missing`);
  }
});

test("the emblem source has no tile or background rectangle", () => {
  const svg = fs.readFileSync(path.join(repo, "apps", "web", "public", "icons", "weave_forge.svg"), "utf8");
  assert.doesNotMatch(svg, /<rect\b/, "weave_forge.svg has a <rect>: a tile behind the emblem");
  assert.doesNotMatch(svg, /--logo-bg/, "weave_forge.svg still sets a background colour");
});
