// Writes a dense 50-page ink note (25k strokes) into a Dev workspace; test data only, never the real workspace.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { encodeInkChunk, makeInkStroke, newInkChunkId, blankInkPage } from "../../packages/core/src/index.ts";

const WS = process.argv[2]; // the Dev workspace folder
const PROJECT = `${WS}/${process.argv[3]}`; // a project folder inside it
if (!WS || !process.argv[3]) throw new Error("usage: node --import tsx scripts/perf/gen-dense-ink.mts <workspace> <project-folder>");
const PAGES = 50, STROKES = 500, POINTS = 30;
const codec = { id: "deflate-raw" as const, compress: async (b: Uint8Array) => new Uint8Array(deflateRawSync(b)), decompress: async (b: Uint8Array) => new Uint8Array(inflateRawSync(b)) };

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const id = randomUUID();
mkdirSync(`${WS}/.ink/${id}`, { recursive: true });
const order: string[] = [];
let bytes = 0;
for (let p = 0; p < PAGES; p++) {
  const strokes = [];
  for (let s = 0; s < STROKES; s++) {
    // Handwriting-like: 25 lines, 20 words per line.
    let x = 150 + (s % 20) * 90, y = 200 + Math.floor(s / 20) * 105;
    const points: number[] = [], pressures: number[] = [];
    for (let i = 0; i < POINTS; i++) {
      x += 2 + rnd() * 3; y += Math.sin(i / 2) * 6 + (rnd() - 0.5) * 4;
      points.push(Math.round(x), Math.round(y)); pressures.push(80 + Math.floor(rnd() * 120));
    }
    strokes.push(makeInkStroke({ points, pressures, t0: (p * STROKES + s) * 400 }));
  }
  const chunk = await encodeInkChunk({ ...blankInkPage("blank"), strokes }, codec);
  const cid = newInkChunkId({ now: Date.now() + p });
  order.push(cid);
  bytes += chunk.length;
  writeFileSync(`${WS}/.ink/${id}/${cid}.inkb`, chunk);
}
const now = new Date().toISOString();
writeFileSync(`${PROJECT}/notes/perf-dense-ink.ink.md`, `---
weaveforge-id: ${id}
weaveforge-type: ink_page
title: "Perf dense ink"
updated-at: "${now}"
created-at: "${now}"
ink-pages: ${PAGES}
ink-paper: blank
ink-page-order: ${JSON.stringify(order)}
ink-recognised: 0
ink-hand: right
aliases: ["Perf dense ink"]
---
`);
console.log(JSON.stringify({ id, pages: PAGES, strokes: PAGES * STROKES, bytes }));
