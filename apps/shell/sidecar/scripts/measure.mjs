// Phase 2.3 spike measurement: bundle the sidecar, size what would ship, run it, read idle memory.
// Usage: node apps/shell/sidecar/scripts/measure.mjs <out-dir>
// Brotli q9 per file stands in for the installer's LZMA; numbers are for the host's node.exe.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const out = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "wf-sidecar-out"));
fs.mkdirSync(out, { recursive: true });
const req = createRequire(path.join(repo, "package.json"));
const { build } = await import(pathToFileURL(req.resolve("esbuild")).href);
await build({
  entryPoints: [path.join(repo, "apps/shell/sidecar/src/main.ts")],
  bundle: true, platform: "node", format: "esm", target: "node22",
  outfile: path.join(out, "main.mjs"), external: ["@electric-sql/pglite", "@electric-sql/pglite/*"],
  tsconfig: path.join(repo, "apps/shell/sidecar/tsconfig.json"), minify: true, logLevel: "warning",
});

const files = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? files(path.join(d, e.name)) : [path.join(d, e.name)]);
let pg = path.dirname(req.resolve("@electric-sql/pglite"));
while (path.basename(pg) !== "pglite") pg = path.dirname(pg);
// What ships: node.exe, the bundle, PGlite's runtime (no source maps, no other extensions), migrations.
const pgFiles = files(path.join(pg, "dist")).filter((f) => !f.endsWith(".map") &&
  (!f.includes(`${path.sep}contrib${path.sep}`) || path.basename(f).startsWith("pgcrypto")));
const groups = {
  nodeExe: [process.execPath],
  pglite: pgFiles,
  bundle: [path.join(out, "main.mjs")],
  migrations: [...files(path.join(repo, "db/migrations")), ...files(path.join(repo, "db/migrations-local"))],
};
const brotli = (f) => zlib.brotliCompressSync(fs.readFileSync(f),
  { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }).length;
const mb = (b) => (b / 1048576).toFixed(1) + " MB";
let raw = 0, packed = 0;
for (const [name, list] of Object.entries(groups)) {
  const r = list.reduce((n, f) => n + fs.statSync(f).size, 0);
  const p = list.reduce((n, f) => n + brotli(f), 0);
  raw += r; packed += p;
  console.log(`${name}: ${mb(r)} raw, ${mb(p)} brotli`);
}
console.log(`total: ${mb(raw)} raw, ${mb(packed)} brotli`);

// Run the bundle beside a pglite link, so it resolves PGlite the way an install would.
const nm = path.join(out, "node" + "_modules", "@electric-sql");
fs.mkdirSync(nm, { recursive: true });
if (!fs.existsSync(path.join(nm, "pglite"))) fs.symlinkSync(pg, path.join(nm, "pglite"), "junction");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-sidecar-measure-"));
const child = spawn(process.execPath, [path.join(out, "main.mjs"), "--data-dir", path.join(tmp, "db"),
  "--migrations", path.join(repo, "db/migrations"), "--migrations", path.join(repo, "db/migrations-local")],
  { stdio: ["pipe", "pipe", "inherit"] });
const lines = createInterface({ input: child.stdout });
const reply = (id) => new Promise((res) => lines.on("line", (l) => { const r = JSON.parse(l); if (r.id === id) res(r); }));
const t0 = Date.now();
child.stdin.write('{"id":1,"method":"query","params":{"sql":"select count(*)::int as n from pg_tables"}}\n');
console.log("first query:", JSON.stringify((await reply(1)).value), `${Date.now() - t0} ms`);
await new Promise((r) => setTimeout(r, 10_000));
if (process.platform === "win32") {
  const [priv, ws] = execFileSync("powershell", ["-NoProfile", "-Command",
    `$p=Get-Process -Id ${child.pid}; "$($p.PrivateMemorySize64) $($p.WorkingSet64)"`])
    .toString().trim().split(" ").map(Number);
  console.log(`idle private: ${mb(priv)}, working set: ${mb(ws)}`);
}
child.stdin.end();
console.log("exit:", await new Promise((r) => child.on("exit", r)));
fs.rmSync(tmp, { recursive: true, force: true });
