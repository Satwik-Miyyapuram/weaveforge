import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Builds the copy of the app that goes inside the installer.
 *
 * The same source as the web build, exported to static files with no server
 * behind it — `docs/plans/future/offline-first-sync.md` D8. `next.config.mjs`
 * switches on `WEAVEFORGE_DESKTOP` and does the rest; this script exists for
 * the one thing a config cannot express.
 *
 * That thing is routes the exported build must not contain, of which there are
 * two kinds and no per-route way to say so:
 *
 *   - **`app/api`.** `output: "export"` refuses to build a route handler at
 *     all, and refusing is correct — a handler in a static bundle would be a
 *     server endpoint with nothing serving it. Twenty-eight of the thirty-four
 *     are org, sharing, SDK and account endpoints the offline app does not have
 *     (D3, D10); the rest move to IPC in the main process.
 *   - **`app/experiments`.** A dynamic route whose ids come from the SDK at run
 *     time. An export needs every path known at build time, and there is no
 *     honest set to give it — `generateStaticParams` returning nothing is
 *     rejected, and inventing a placeholder id would generate a page that
 *     exists only to 404 differently. Experiments are the SDK surface, which
 *     talks to a server the offline app does not have (D10), so the route being
 *     absent is the correct outcome rather than a limitation.
 *
 * Moving directories in the working tree is a blunt instrument, so it is done
 * carefully: they are restored in a `finally`, restored on a signal, and the
 * build refuses to start if a previous run left a holding directory behind.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const web = path.resolve(root, "../web");
// Where the export lands. Not `out/`: `next.config.mjs` gives the desktop build
// its own `distDir` so it cannot collide with a running dev server, and an
// export replaces that directory with the static files rather than adding a
// second one beside it.
const exported = path.join(web, ".next-desktop");
const destination = path.join(root, "dist/web");

/** Route directories held aside for the build, as `[real, holding]` pairs. */
const heldAside = ["api", "experiments"].map((name) => [
  path.join(web, "src/app", name),
  path.join(web, `src/.${name}-held-for-desktop-build`),
]);

for (const [real, holding] of heldAside) {
  if (fs.existsSync(holding)) {
    throw new Error(
      `${holding} already exists, which means an earlier desktop build did not finish. ` +
        `Move its contents back to ${real} before building again — this script will not ` +
        "guess which of the two is the real one.",
    );
  }
}

for (const [real, holding] of heldAside) {
  if (fs.existsSync(real)) fs.renameSync(real, holding);
}

/** Put the routes back. Safe to call twice; the second call finds nothing. */
function restore() {
  for (const [real, holding] of heldAside) {
    if (fs.existsSync(holding) && !fs.existsSync(real)) fs.renameSync(holding, real);
  }
}

// A build interrupted at the keyboard must not leave the working tree missing a
// directory. `exit` covers a normal finish and an uncaught throw; the signals
// cover Ctrl-C, which does not run exit handlers on its own.
process.on("exit", restore);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    restore();
    process.exit(1);
  });
}

try {
  execFileSync("npm", ["run", "build"], {
    cwd: web,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, WEAVEFORGE_DESKTOP: "1" },
  });
} finally {
  restore();
}

if (!fs.existsSync(path.join(exported, "index.html"))) {
  throw new Error(`The export produced no index.html in ${exported}.`);
}

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.cpSync(exported, destination, { recursive: true });

const files = countFiles(destination);
console.log(`Bundled the app: ${files} files into ${path.relative(root, destination)}`);

function countFiles(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    total += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1;
  }
  return total;
}
