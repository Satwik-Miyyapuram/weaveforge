/**
 * Runs the Rust gates from `scripts/lib/rust-gates.mjs` in order. Pre-push and CI
 * both call this script so neither can run a different gate set. `--local` skips
 * the network-only gates (pre-push stays offline). An optional list of gate names
 * restricts the run; unknown names fail rather than silently skip.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CARGO_PLUGINS, RUST_GATES } from "./lib/rust-gates.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const known = RUST_GATES.map((g) => g.name);

const argv = process.argv.slice(2);
const local = argv.includes("--local");
const requested = argv.filter((a) => a !== "--local");
for (const name of requested) {
  if (!known.includes(name)) {
    console.error(`FAIL: unknown rust gate ${name}; known: ${known.join(", ")}`);
    process.exit(1);
  }
}

const ok = (args) => {
  const r = spawnSync("cargo", args, { cwd: repoRoot, stdio: "ignore" });
  return !r.error && r.status === 0;
};
if (!ok(["--version"])) {
  console.error("FAIL: cargo not found. Install Rust via rustup; rust-toolchain.toml pins the version.");
  process.exit(1);
}
const missing = CARGO_PLUGINS.filter((p) => !ok([p, "--version"]));
if (missing.length) {
  console.error(`FAIL: missing cargo-${missing.join(", cargo-")}. Run: cargo install --locked cargo-nextest cargo-deny`);
  process.exit(1);
}

const selected = RUST_GATES.filter(
  (g) => (requested.length ? requested.includes(g.name) : true) && !(local && g.ciOnly),
);

for (const g of selected) {
  console.log(`==> [rust] ${g.name}`);
  const result = spawnSync(g.cmd, g.args, { cwd: repoRoot, stdio: "inherit", shell: false });
  if (result.error || result.status !== 0) {
    console.error(`FAIL: rust gate ${g.name} (cargo ${g.args.join(" ")})`);
    process.exit(1);
  }
}

console.log(`Rust gates OK (${selected.length} gates).`);
