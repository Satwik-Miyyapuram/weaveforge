/**
 * Single source for the Rust gates (plan §4.5, docs/plans/current/rust-port/plan.md).
 * Pre-push and CI both run `scripts/check-rust.mjs`, which reads this list, so the
 * gates cannot drift between local and CI runs.
 *
 * `ciOnly` gates need the network (the advisory database); pre-push skips them
 * with `--local` so it stays offline.
 */

const gate = (name, args, ciOnly = false) =>
  Object.freeze({ name, cmd: "cargo", args: Object.freeze(args), ciOnly });

// The shell and the relays share the root workspace and Cargo.lock, but have their own
// CI jobs and deny.toml: Tauri and reqwest bring duplicate crate versions that the
// strict bans here must not take in.
export const OWN_JOB_CRATES = Object.freeze(["weaveforge-shell", "tauri-plugin-ink", "wf-relay", "wf-relay-server"]);
const excludeOwnJobs = OWN_JOB_CRATES.flatMap((crate) => ["--exclude", crate]);

export const RUST_GATES = Object.freeze([
  gate("fmt", ["fmt", "--all", "--check"]),
  gate("clippy", [
    "clippy",
    "--workspace",
    ...excludeOwnJobs,
    "--all-targets",
    "--locked",
    "--",
    "-D",
    "warnings",
    "-D",
    "clippy::unwrap_used",
    "-D",
    "clippy::expect_used",
    "-D",
    "clippy::panic",
  ]),
  gate("nextest", ["nextest", "run", "--workspace", ...excludeOwnJobs, "--locked", "--no-tests=fail"]),
  // nextest does not run doc tests; plan §4.4 gates them too.
  gate("doctest", ["test", "--doc", "--workspace", ...excludeOwnJobs, "--locked"]),
  gate("deny", ["deny", "--locked", ...excludeOwnJobs, "check", "licenses", "bans", "sources"]),
  gate("advisories", ["deny", "--locked", ...excludeOwnJobs, "check", "advisories"], true),
]);

/** Cargo subcommands that are not part of rustup; check-rust.mjs probes for them. */
export const CARGO_PLUGINS = Object.freeze(["nextest", "deny"]);
