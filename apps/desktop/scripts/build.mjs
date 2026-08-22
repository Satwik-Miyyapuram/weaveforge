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
// The web app's own tsconfig maps `@weaveforge/core` to the package's *source*.
// Resolving it here by package name instead would bundle `packages/core/dist`
// as a second module — the same code twice, and the copy this app's own files
// got could be a stale build that disagrees with the copy the web modules got.
// One mapping, so there is one core in the bundle.
const coreSrc = path.resolve(root, "../../packages/core/src/index.ts");
/** The app's icon, kept once, in the web app's public assets. */
const iconPng = path.resolve(root, "../web/public/icons/icon-512.png");
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
  // PGlite ships WASM and its own filesystem shims; bundling it would inline
  // megabytes of base64 and still not resolve the assets it loads at runtime.
  external: ["electron", "@electric-sql/pglite"],
  alias: { "@": webSrc, "@weaveforge/core": coreSrc },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __DEFAULT_APP_URL__: JSON.stringify(process.env.WEAVEFORGE_URL ?? "http://localhost:3000"),
  },
  logLevel: "info",
};

fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.mkdirSync(path.join(root, "build"), { recursive: true });

/**
 * The icon, in the two shapes the platform wants.
 *
 * Both are generated from the web app's own 512px icon rather than committed
 * beside it, so there is one picture in the repository and no second copy to
 * forget when it changes. `dist/icon.png` is what the window is created with;
 * `build/icon.ico` is what the installer and its shortcuts use, because NSIS
 * takes nothing else.
 */
fs.copyFileSync(iconPng, path.join(root, "dist/icon.png"));

/**
 * The migrations, shipped beside the bundle.
 *
 * The same files the server runs — copied rather than re-authored, because a
 * local database whose schema is a hand-kept second version of the real one is
 * a sync bug waiting for a release to happen in.
 */
const migrations = path.resolve(root, "../../supabase/migrations");
fs.mkdirSync(path.join(root, "dist/migrations"), { recursive: true });
for (const file of fs.readdirSync(migrations).filter((name) => name.endsWith(".sql"))) {
  fs.copyFileSync(path.join(migrations, file), path.join(root, "dist/migrations", file));
}

/** The tables that exist only on a device: the outbox and the watermark. */
const localMigrations = path.resolve(root, "../../supabase/migrations-local");
fs.mkdirSync(path.join(root, "dist/migrations-local"), { recursive: true });
for (const file of fs.readdirSync(localMigrations).filter((name) => name.endsWith(".sql"))) {
  fs.copyFileSync(path.join(localMigrations, file), path.join(root, "dist/migrations-local", file));
}
fs.writeFileSync(path.join(root, "build/icon.ico"), ico(fs.readFileSync(iconPng)));

/**
 * A single-image .ico wrapping a PNG.
 *
 * An icon directory of one entry, with the PNG stored whole — the format has
 * allowed that since Vista, and it avoids unpacking and re-encoding a bitmap
 * just to change the container. A 512px image is declared as 0, which is how
 * the format spells "256 or larger".
 */
function ico(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // an icon, not a cursor
  header.writeUInt16LE(1, 4); // one image
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0); // width: 256 or larger
  entry.writeUInt8(0, 1); // height: likewise
  entry.writeUInt8(0, 2); // not a paletted image
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);
  return Buffer.concat([header, entry, png]);
}

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
