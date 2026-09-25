#!/usr/bin/env node
/**
 * Bundle the sentence-encoder worker into `public/` as a static asset.
 *
 * ## Why this exists, and why the obvious thing does not work
 *
 * `worker-embedder.ts` used to create its worker the documented Next.js way:
 *
 *     new Worker(new URL("./embedding-worker.ts", import.meta.url))
 *
 * It never worked in the desktop build, and it failed in the least helpful way
 * available. Webpack resolved `import.meta.url` to a **filesystem path** — the
 * absolute location of the source file on the build machine —
 *
 *     import.meta.url = "file:///C:/Users/…/src/features/search/infrastructure/embedding-worker.ts"
 *
 * and then handed its own runtime chunk to the `Worker` constructor, whose size
 * the page could observe:
 *
 *     new Worker("app://weaveforge/_next/static/chunks/1637.a81d939c32deeb28.js")
 *
 * Building that URL runs through webpack's Trusted Types shim, which calls a
 * string method on its argument and throws when the argument is not a string, so
 * what the reader saw was `e.replace is not a function` with no file, no line,
 * and no mention of workers at all. Every model load failed there, before a byte
 * was fetched — which is why the model cache stayed empty.
 *
 * **This project already knew.** `copy-pdf-worker.mjs` serves the pdf.js worker
 * from `public/` for the same reason, and says so:
 *
 *   > Why not `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`:
 *   > that makes webpack emit + re-run the already-minified worker through
 *   > Terser, which fails the production build. Serving it as a static asset also
 *   > keeps the worker out of every route's JS graph.
 *
 * The embedding worker is worse served by the bundler than the pdf.js one: it
 * pulls in Transformers.js and onnxruntime-web, tens of megabytes of runtime that
 * only somebody who switches semantic search on should ever download. As a
 * `public/` asset it is fetched by the worker itself, on demand, and stays out of
 * the main graph entirely.
 *
 * The instruction to the runtime is absolute and same-origin
 * (`/embedding-worker.js`), which is also what lets onnxruntime-web resolve its
 * own `.wasm` next to it.
 *
 *   node scripts/build-embedding-worker.mjs
 */
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(webRoot, "src", "features", "search", "infrastructure", "embedding-worker.ts");
const publicDir = join(webRoot, "public");
const outfile = join(publicDir, "embedding-worker.js");

mkdirSync(publicDir, { recursive: true });

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "esm",
  // The worker runs in a browser, so the browser build of every dependency is
  // the right one — the library ships a Node entry that would otherwise be
  // picked and would try to read the weights off a filesystem.
  platform: "browser",
  target: "es2022",
  /*
   * **Not minified, and that is deliberate.**
   *
   * With `minify: true` the worker failed at `this.tokenizer is not a function`
   * — from inside the library, at a frame that explained nothing, while the very
   * same call in Node returned `dims: [1, 384]`. Whatever esbuild's mangling does
   * to that class's member, the result is a worker that loads its runtime,
   * downloads its weights, and then cannot tokenize. A feature that is two-thirds
   * working and fails on the last step is worse than one that fails at the start,
   * so the 1.4 MB is worth paying.
   */
  minify: false,
  sourcemap: false,
  logLevel: "warning",
});

/*
 * onnxruntime-web's own runtime, copied next to the worker.
 *
 * **This is the file the failure named.** With `wasmPaths` pointing at the app
 * root, the worker asks for `app://weaveforge/ort-wasm-simd-threaded.asyncify.mjs`
 * and then the `.wasm` beside it. Nothing emitted either: the Next build bundles
 * onnxruntime-web but does not copy its sidecar assets, so the dynamic import
 * 404'd and the runtime reported
 *
 *     no available backend found. ERR: [wasm] TypeError: Failed to fetch
 *     dynamically imported module: …/ort-wasm-simd-threaded.asyncify.mjs
 *
 * The `asyncify` pair is the one this build asks for — measured, from the error
 * above — and the pair is what is copied, because the `.mjs` is a loader for the
 * `.wasm` and is useless without it. `jsep` (WebGPU) and the plain SIMD variant
 * are a further ~50 MB between them and are not requested here, so they are not
 * shipped; if a future build asks for one, the error will name it exactly as it
 * named this one.
 *
 * This is the same move as `copy-pdf-worker.mjs`: an asset the bundler will not
 * carry, served same-origin from `public/`.
 */
/*
 * The assets' directory, found by walking up from an export the package *does*
 * declare.
 *
 * Nothing under `dist/` is reachable by name — `onnxruntime-web`'s `exports` map
 * refuses both the `.mjs` files and even `package.json`, so every direct
 * `require.resolve` of them answers `ERR_PACKAGE_PATH_NOT_EXPORTED`. The map says
 * what may be *imported*, though, and these are files to copy rather than modules
 * to load. `onnxruntime-web/webgpu` is declared, so its resolved path gives the
 * package's own directory, and `dist/` is beside it.
 */
function ortDistDir() {
  let dir = dirname(require.resolve("onnxruntime-web/webgpu"));
  for (let up = 0; up < 4; up += 1) {
    const candidate = join(dir, "dist");
    if (existsSync(join(candidate, "ort-wasm-simd-threaded.asyncify.mjs"))) return candidate;
    dir = dirname(dir);
  }
  throw new Error("could not locate onnxruntime-web's dist directory from its webgpu export");
}

const ortDir = ortDistDir();
for (const name of [
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
]) {
  const from = join(ortDir, name);
  if (!existsSync(from)) {
    throw new Error(`onnxruntime-web did not ship ${name}; the worker cannot start without it`);
  }
  copyFileSync(from, join(publicDir, name));
}

console.log(`Bundled the encoder worker → ${outfile}`);
console.log(`Copied the onnxruntime-web wasm runtime → ${publicDir}`);
