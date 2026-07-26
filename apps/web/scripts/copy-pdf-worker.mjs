#!/usr/bin/env node
/**
 * Copy the pdf.js worker into public/ so the read-only reader can load it from
 * a same-origin URL (GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs").
 *
 * Why not `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`:
 * that makes webpack emit + re-run the already-minified worker through Terser,
 * which fails the production build. Serving it as a static asset also keeps the
 * worker out of every route's JS graph (zero bytes on non-reader first paint).
 */
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const workerSrc = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const dest = join(publicDir, "pdf.worker.min.mjs");

mkdirSync(publicDir, { recursive: true });
copyFileSync(workerSrc, dest);
console.log(`Copied pdf.js worker → ${dest}`);
