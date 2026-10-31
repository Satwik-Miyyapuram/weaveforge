// Stages the files the Tauri installer ships under `<out>/sidecar/`, in the layout `apps/shell/src/launch.rs` expects.
// Usage: node apps/shell/sidecar/scripts/stage.mjs <out-dir> [--node <exe>] [--node-license <file>]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../../..");
const PGLITE_SCOPE = path.join("node_modules", "@electric-sql", "pglite");

/**
 * What ships from PGlite's dist: no source maps, and only the pgcrypto contrib extension.
 * @param {string} distDir absolute path to PGlite's `dist` directory
 * @returns {string[]} sorted relative paths using "/" separators
 */
export function pgliteFiles(distDir) {
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else found.push(path.relative(distDir, full).split(path.sep).join("/"));
    }
  };
  walk(distDir);
  return found
    .filter((rel) => !rel.endsWith(".map"))
    .filter((rel) => !rel.split("/").includes("contrib") || path.posix.basename(rel).startsWith("pgcrypto"))
    .sort();
}

/** The `.sql` files directly in `dir`. */
function sqlFiles(dir) {
  return fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
}

/**
 * The copy steps that populate `<out>/sidecar/`, except `main.mjs` and `README.txt`.
 * Lists directories and checks licence files exist; copies nothing.
 * @param {{repo: string, out: string, nodeExe: string, nodeLicense?: string, pgliteDir: string, platform: string}} o
 * @returns {{from: string, to: string}[]} steps sorted by `to`
 */
export function stagePlan({ repo, out, nodeExe, nodeLicense, pgliteDir, platform }) {
  const sidecar = path.join(out, "sidecar");
  const notices = path.join(sidecar, "notices");
  const pgOut = path.join(sidecar, PGLITE_SCOPE);

  // The licence beside the node binary is the default; a missing one is a build error, not a silent gap.
  const nodeLic = nodeLicense ?? path.join(path.dirname(nodeExe), "LICENSE");
  if (!fs.existsSync(nodeLic)) throw new Error("node LICENSE not found; pass --node-license");
  const pgLic = path.join(pgliteDir, "LICENSE");
  if (!fs.existsSync(pgLic)) throw new Error("@electric-sql/pglite LICENSE not found");

  const migrations = path.join(repo, "db/migrations");
  const localMigrations = path.join(repo, "db/migrations-local");
  const steps = [
    { from: nodeExe, to: path.join(sidecar, platform === "win32" ? "node.exe" : "node") },
    {
      from: path.join(repo, "plugins/weaveforge-research/mcp-server/index.mjs"),
      to: path.join(sidecar, "weaveforge-mcp.mjs"),
    },
    ...sqlFiles(migrations).map((f) => ({ from: path.join(migrations, f), to: path.join(sidecar, "migrations", f) })),
    ...sqlFiles(localMigrations).map((f) => ({
      from: path.join(localMigrations, f),
      to: path.join(sidecar, "migrations-local", f),
    })),
    { from: path.join(pgliteDir, "package.json"), to: path.join(pgOut, "package.json") },
    ...pgliteFiles(path.join(pgliteDir, "dist")).map((rel) => ({
      from: path.join(pgliteDir, "dist", ...rel.split("/")),
      to: path.join(pgOut, "dist", ...rel.split("/")),
    })),
    { from: nodeLic, to: path.join(notices, "node-LICENSE") },
    { from: pgLic, to: path.join(notices, "pglite-LICENSE") },
  ];
  return steps.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
}

/**
 * The `notices/README.txt` text: what ships and which licence file covers each component.
 * @param {{nodeVersion: string, pgliteVersion: string}} v
 * @returns {string}
 */
export function noticeText({ nodeVersion, pgliteVersion }) {
  return [
    "WeaveForge sidecar: bundled third-party components",
    "",
    "Licence texts for these components are in this folder:",
    `node ${nodeVersion} — node-LICENSE`,
    `@electric-sql/pglite ${pgliteVersion} — pglite-LICENSE`,
    "",
  ].join("\n");
}

/** Walks up from PGlite's entry point to its package directory. */
function pgliteRoot(req) {
  let dir = path.dirname(req.resolve("@electric-sql/pglite"));
  while (path.basename(dir) !== "pglite") {
    const up = path.dirname(dir);
    if (up === dir) throw new Error("@electric-sql/pglite package directory not found");
    dir = up;
  }
  return dir;
}

/**
 * Bundles and copies the sidecar into `<out>/sidecar/`. Refuses a non-empty existing one; deletes nothing.
 * @param {{repo: string, out: string, node?: string, nodeLicense?: string}} o
 * @returns {Promise<{files: number, bytes: number}>}
 */
export async function stage({ repo, out, node = process.execPath, nodeLicense }) {
  repo = path.resolve(repo);
  out = path.resolve(out);
  const sidecar = path.join(out, "sidecar");
  // Stale files from an earlier stage would ship alongside the new ones.
  if (fs.existsSync(sidecar) && fs.readdirSync(sidecar).length > 0) {
    throw new Error(`${sidecar} is not empty; remove it first`);
  }

  const req = createRequire(path.join(repo, "package.json"));
  const pgliteDir = pgliteRoot(req);
  const plan = stagePlan({
    repo, out, nodeExe: path.resolve(node),
    nodeLicense: nodeLicense && path.resolve(nodeLicense),
    pgliteDir, platform: process.platform,
  });

  fs.mkdirSync(sidecar, { recursive: true });
  const { build } = await import(pathToFileURL(req.resolve("esbuild")).href);
  const main = path.join(sidecar, "main.mjs");
  await build({
    entryPoints: [path.join(repo, "apps/shell/sidecar/src/main.ts")],
    bundle: true, platform: "node", format: "esm", target: "node22",
    outfile: main, external: ["@electric-sql/pglite", "@electric-sql/pglite/*"],
    tsconfig: path.join(repo, "apps/shell/sidecar/tsconfig.json"), minify: true, logLevel: "warning",
  });

  for (const { from, to } of plan) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }

  const pgliteVersion = JSON.parse(fs.readFileSync(path.join(pgliteDir, "package.json"), "utf8")).version;
  const readme = path.join(sidecar, "notices", "README.txt");
  fs.mkdirSync(path.dirname(readme), { recursive: true });
  fs.writeFileSync(readme, noticeText({ nodeVersion: process.version, pgliteVersion }));

  const written = [...plan.map((s) => s.to), main, readme];
  const bytes = written.reduce((n, f) => n + fs.statSync(f).size, 0);
  return { files: written.length, bytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const outDir = args[0];
  if (!outDir || outDir.startsWith("--")) {
    console.error("usage: node apps/shell/sidecar/scripts/stage.mjs <out-dir> [--node <exe>] [--node-license <file>]");
    process.exit(2);
  }
  const { files, bytes } = await stage({
    repo: REPO,
    out: outDir,
    node: opt("--node"),
    nodeLicense: opt("--node-license"),
  });
  console.log(`staged ${files} files, ${(bytes / 1048576).toFixed(1)} MB into ${path.resolve(outDir, "sidecar")}`);
}
