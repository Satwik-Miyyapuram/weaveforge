// Stages the Postgres the Tauri installer ships under `<out>/postgres/`, the layout
// `apps/shell/src/local_pg/server.rs` (`locate_bin`) expects: `postgres/bin/postgres[.exe]`.
// Usage: node apps/shell/scripts/stage-postgres.mjs <postgres-dist-dir> <out-dir> [--platform win32|linux|darwin]
//
// Only what the app runs is copied: the server, initdb, pg_ctl, pg_dump and pg_restore, the
// libraries they load, plpgsql and pgcrypto (the only extensions the migrations create), the
// text search and encoding modules initdb needs, and the licences.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The programs the shell starts. */
export const TOOLS = ["postgres", "initdb", "pg_ctl", "pg_dump", "pg_restore"];

/** Server modules kept from `lib/`: the languages and extensions in use, and what initdb loads. */
export const MODULES = ["plpgsql", "pgcrypto", "dict_snowball"];

/** Libraries in `bin/` the tools never load: Python, the embedded-SQL runtime, build helpers, XSLT. */
const UNUSED_LIBS = /^(python\d*|pkgconf-\d+|libecpg.*|libpgtypes|libxslt|libexslt)$/i;

/** Licence and provenance files kept from the dist root. */
const NOTICES = ["COPYRIGHT", "LICENSE", "README.md", "build-manifest.json", "runtime-dependencies.json", "source-input.json"];

/** `name` without its extensions: `libssl-3-x64.dll` -> `libssl-3-x64`, `libpq.so.5` -> `libpq`. */
function stem(name) {
  const dot = name.indexOf(".");
  return dot < 0 ? name : name.slice(0, dot);
}

/** Whether a `lib/` module converts between encodings (`utf8_and_win`, `latin2_and_win1250`, ...). */
const isConversion = (s) => /_and_/.test(s);

/** Every file under `dir`, relative, with "/" separators. */
function walk(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

/**
 * Which files of the dist ship, as paths relative to it. Lists, copies nothing.
 * @param {string} dist the extracted Postgres distribution
 * @param {string} platform `process.platform` of the target
 * @returns {string[]} sorted relative paths with "/" separators
 */
export function postgresFiles(dist, platform) {
  const win = platform === "win32";
  const exe = (tool) => (win ? `${tool}.exe` : tool);
  const missing = TOOLS.map(exe).filter((t) => !fs.existsSync(path.join(dist, "bin", t)));
  if (missing.length) throw new Error(`not a Postgres dist, bin/ lacks: ${missing.join(", ")}`);

  const keep = [];
  for (const rel of walk(path.join(dist, "bin"))) {
    if (rel.includes("/")) continue; // bin/DLLs, bin/Lib: the bundled Python
    const isLib = /\.(dll|so(\.\d+)*|dylib)$/i.test(rel);
    if (TOOLS.map(exe).includes(rel) || (isLib && !UNUSED_LIBS.test(stem(rel)))) keep.push(`bin/${rel}`);
  }
  for (const rel of walk(path.join(dist, "lib"))) {
    const name = path.posix.basename(rel);
    if (/\.(a|lib|pc|la)$/i.test(name) || rel.split("/").includes("pkgconfig")) continue;
    const s = stem(name);
    const sharedLib = !win && /^lib/.test(name) && /\.(so(\.\d+)*|dylib)$/.test(name);
    if (MODULES.includes(s) || isConversion(s) || sharedLib) keep.push(`lib/${rel}`);
  }
  for (const rel of walk(path.join(dist, "share"))) {
    const top = rel.split("/")[0];
    if (top === "doc") continue;
    if (top === "extension" && !MODULES.some((m) => path.posix.basename(rel).startsWith(`${m}.`) || path.posix.basename(rel).startsWith(`${m}--`))) continue;
    keep.push(`share/${rel}`);
  }
  for (const rel of walk(path.join(dist, "dependency-notices"))) keep.push(`dependency-notices/${rel}`);
  for (const name of NOTICES) if (fs.existsSync(path.join(dist, name))) keep.push(name);
  return keep.sort();
}

/** The Postgres major the installer ships (release-desktop.yml stages `postgresql-18.x`). */
export const SHIPPED_MAJOR = 18;

/**
 * Throws unless the Postgres in `dir` (an extracted dist, or a stage's `postgres/`) is the shipped
 * major, read from its `build-manifest.json`. Refusing here stops a stale Postgres 16 from ever
 * reaching an installer, where the 18 cluster on user machines cannot start with it.
 * @param {string} dir directory holding `build-manifest.json`
 * @param {number} [major] the major required
 * @returns {string} the full version, e.g. "18.6"
 */
export function assertPostgresMajor(dir, major = SHIPPED_MAJOR) {
  const file = path.join(dir, "build-manifest.json");
  if (!fs.existsSync(file)) throw new Error(`no build-manifest.json in ${dir}: cannot tell the Postgres major`);
  const version = JSON.parse(fs.readFileSync(file, "utf8"))?.source?.version;
  if (typeof version !== "string") throw new Error(`build-manifest.json in ${dir} has no source.version`);
  const got = Number(version.split(".")[0]);
  if (got !== major) {
    throw new Error(`Postgres ${version} in ${dir} is major ${got}; the installer ships major ${major}. Restage ${major}.x.`);
  }
  return version;
}

/** Copies the kept files to `<out>/postgres/`, replacing what a previous run staged there. */
export function stagePostgres(dist, out, platform = process.platform) {
  assertPostgresMajor(dist);
  const files = postgresFiles(dist, platform);
  const target = path.join(out, "postgres");
  fs.rmSync(target, { recursive: true, force: true });
  for (const rel of files) {
    const to = path.join(target, ...rel.split("/"));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(dist, ...rel.split("/")), to);
  }
  return { target, files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--check") {
    // Bundle-time gate: `--check <out-dir>/postgres` fails unless the staged Postgres is the shipped major.
    const version = assertPostgresMajor(path.resolve(args[1] ?? "apps/shell/target/stage/postgres"));
    console.log(`staged Postgres ${version} is major ${SHIPPED_MAJOR}`);
    process.exit(0);
  }
  const flag = args.indexOf("--platform");
  const platform = flag >= 0 ? args.splice(flag, 2)[1] : process.platform;
  const [dist, out] = args;
  if (!dist || !out) {
    console.error("usage: stage-postgres.mjs <postgres-dist-dir> <out-dir> [--platform win32|linux|darwin]");
    process.exit(2);
  }
  const { target, files } = stagePostgres(path.resolve(dist), path.resolve(out), platform);
  const bytes = files.reduce((n, rel) => n + fs.statSync(path.join(target, ...rel.split("/"))).size, 0);
  console.log(`staged ${files.length} files (${(bytes / 1048576).toFixed(1)} MB) in ${target}`);
}
