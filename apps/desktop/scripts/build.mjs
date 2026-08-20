import { build } from "esbuild";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Bundles the two files this app is made of.
 *
 * esbuild rather than `tsc`, for one reason that matters: the main process
 * imports the web app's own modules by their `@/…` specifiers, and the whole
 * point of the desktop app is that it reuses them instead of holding a second
 * copy. A bundler resolves that alias and pulls in exactly what is reachable —
 * `fetch-for-paste`, `safe-fetch`, and the parts of `@weaveforge/core` they
 * use — and nothing else from the web app comes along.
 *
 * Both outputs are CommonJS. Electron's preload must be a single CJS file when
 * the renderer is sandboxed, and there is nothing to gain by making the main
 * process the exception.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const webSrc = path.resolve(root, "../web/src");
const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  // Electron supplies these; bundling them would mean two copies of Electron's
  // own module registry and a `node:` builtin resolved at the wrong layer.
  external: ["electron"],
  alias: { "@": webSrc },
  define: { __APP_VERSION__: JSON.stringify(version) },
  logLevel: "info",
};

fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });

await Promise.all([
  build({
    ...shared,
    entryPoints: [path.join(root, "src/main.ts")],
    outfile: path.join(root, "dist/main.js"),
  }),
  build({
    ...shared,
    entryPoints: [path.join(root, "src/preload.ts")],
    outfile: path.join(root, "dist/preload.js"),
  }),
]);
