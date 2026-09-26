import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Makes the themed Windows setup file: the installer window in
 * `installer/setup` with electron-builder's NSIS installer carried inside it.
 *
 * The NSIS file stays in the release beside it, unchanged, because the in-app
 * updater downloads that one (it is what `latest.yml` names) and runs it
 * silently. People downloading WeaveForge get `WeaveForge-<version>-Windows-Installer.exe`,
 * which shows the app's own pages and runs the same NSIS file behind them.
 *
 * Layout, read back by `installer/setup/src/main.rs`:
 *
 *   [window exe][NSIS exe][meta json][NSIS len u64 LE][meta len u64 LE]["WFSETUP1"]
 *
 * Usage: `node scripts/pack-setup.mjs [--target <rust target triple>]`, after
 * `electron-builder --win` has filled `release/`. Without `--target` the
 * window is built for this machine.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const release = path.join(root, "release");
const crate = path.join(root, "installer", "setup");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const at = process.argv.indexOf("--target");
const target = at > 0 ? process.argv[at + 1] : null;

const nsis = path.join(release, `WeaveForge Setup ${version}.exe`);
if (!fs.existsSync(nsis)) {
  console.error(`pack-setup: ${path.relative(root, nsis)} is missing; run electron-builder --win first.`);
  process.exit(1);
}

execFileSync("cargo", ["build", "--release", ...(target ? ["--target", target] : [])], {
  cwd: crate,
  stdio: "inherit",
});
const shell = path.join(crate, "target", ...(target ? [target] : []), "release", "weaveforge-setup.exe");

/** Bytes under `dir`, for the progress bar's idea of "done". */
function size(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? size(full) : fs.statSync(full).size;
  }
  return total;
}
// The biggest of the unpacked builds: a multi-arch installer installs one of
// them, and a bar that finishes a little early reads better than one that stalls.
const unpacked = fs
  .readdirSync(release, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^win-.*unpacked$/.test(entry.name))
  .map((entry) => size(path.join(release, entry.name)));
const installSize = unpacked.length ? Math.max(...unpacked) : fs.statSync(nsis).size * 3;

const meta = Buffer.from(JSON.stringify({ version, installSize }));
const trailer = Buffer.alloc(24);
trailer.writeBigUInt64LE(BigInt(fs.statSync(nsis).size), 0);
trailer.writeBigUInt64LE(BigInt(meta.length), 8);
trailer.write("WFSETUP1", 16, "ascii");

const out = path.join(release, `WeaveForge-${version}-Windows-Installer.exe`);
fs.copyFileSync(shell, out);
fs.appendFileSync(out, fs.readFileSync(nsis));
fs.appendFileSync(out, meta);
fs.appendFileSync(out, trailer);
console.log(`pack-setup: ${path.relative(root, out)} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
