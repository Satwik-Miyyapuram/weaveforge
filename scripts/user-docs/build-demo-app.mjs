// Builds the docs' demo app into docs/.site-demo/: the real app's static export
// (apps/shell/scripts/build-web.mjs, the desktop build) with demo-bridge.js first
// in every page, PGlite, and the demo database from demo-db.mts under /_demo/.
// Served at its own root (the app uses absolute paths), read-only in the docs.
//
//   node scripts/user-docs/build-demo-app.mjs           build everything
//   node scripts/user-docs/build-demo-app.mjs --reuse   reuse apps/shell/dist/web and docs/.demo
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const web = path.join(root, "apps/web");
const exported = path.join(root, "apps/shell/dist/web");
const demo = path.join(root, "docs/.demo");
const OUT = path.join(root, "docs/.site-demo");
const reuse = process.argv.includes("--reuse");

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

if (!reuse || !existsSync(path.join(demo, "db.tar.gz"))) {
  run("node", ["--import", "tsx", "--import", "./src/lib/test/preload-core.mts", "../../scripts/user-docs/demo-db.mts"], {
    cwd: web,
    env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.test.json" },
  });
}
if (!reuse || !existsSync(path.join(exported, "index.html"))) {
  // The demo never signs in: placeholder Supabase values, never real keys.
  run("node", ["apps/shell/scripts/build-web.mjs"], {
    cwd: root,
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://demo.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "docs-demo" },
  });
}

rmSync(OUT, { recursive: true, force: true });
cpSync(exported, OUT, { recursive: true });

// The bridge opens the demo project before the app's scripts ask for one.
const { projectId } = JSON.parse(readFileSync(path.join(demo, "files.json"), "utf8"));
const TAG = `<script src="/_demo/bridge.js" data-project="${projectId}"></script>`;
function inject(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) inject(p);
    else if (name.endsWith(".html")) writeFileSync(p, readFileSync(p, "utf8").replace("<head>", "<head>" + TAG));
  }
}
inject(OUT);

const assets = path.join(OUT, "_demo");
const pglite = path.join(path.dirname(createRequire(path.join(web, "package.json")).resolve("@electric-sql/pglite")), ".");
mkdirSync(assets, { recursive: true });
cpSync(pglite, path.join(assets, "pglite"), {
  recursive: true,
  filter: (src) => !/\.(map|cjs|d\.ts|d\.cts)$/.test(src) && path.basename(src) !== "desktop.ini",
});
for (const f of ["db.tar.gz", "files.json"]) cpSync(path.join(demo, f), path.join(assets, f));
for (const f of ["demo-query.mjs", "demo-bridge.js"]) cpSync(path.join(here, f), path.join(assets, f === "demo-bridge.js" ? "bridge.js" : f));
console.log(`demo app -> ${path.relative(root, OUT)}`);
