/**
 * Pins the Rust gate list. pre-push and CI both run `scripts/check-rust.mjs`,
 * so a silently weakened gate would pass locally and in CI alike.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARGO_PLUGINS, RUST_GATES } from "../rust-gates.mjs";

const gate = (name) => RUST_GATES.find((g) => g.name === name);

test("lists the gates in order", () => {
  assert.deepEqual(
    RUST_GATES.map((g) => g.name),
    ["fmt", "clippy", "nextest", "doctest", "bindings", "deny", "advisories"],
  );
});

test("every gate is cargo with a non-empty args array", () => {
  for (const g of RUST_GATES) {
    assert.equal(g.cmd, "cargo");
    assert.ok(Array.isArray(g.args) && g.args.length > 0, `${g.name} has no args`);
  }
});

test("fmt only checks", () => {
  assert.deepEqual(gate("fmt").args, ["fmt", "--all", "--check"]);
});

test("clippy denies warnings, unwrap, expect and panic on all targets", () => {
  const args = gate("clippy").args;
  assert.ok(args.includes("--all-targets"));
  const after = args.slice(args.indexOf("--") + 1);
  for (const lint of ["warnings", "clippy::unwrap_used", "clippy::expect_used", "clippy::panic"]) {
    const i = after.indexOf(lint);
    assert.ok(i > 0 && after[i - 1] === "-D", `missing -D ${lint}`);
  }
});

test("cargo gates that resolve dependencies use the committed lockfile", () => {
  for (const name of ["clippy", "nextest", "doctest", "bindings", "deny", "advisories"]) {
    const args = gate(name).args;
    const end = args.includes("--") ? args.indexOf("--") : args.length;
    assert.ok(args.slice(0, end).includes("--locked"), `${name} lacks --locked`);
  }
});

test("nextest runs the whole workspace and fails when no test runs", () => {
  assert.deepEqual(gate("nextest").args, ["nextest", "run", "--workspace", "--locked", "--no-tests=fail"]);
});

test("doc tests are gated", () => {
  assert.deepEqual(gate("doctest").args, ["test", "--doc", "--workspace", "--locked"]);
});

test("bindings gate fails when the generated TypeScript is stale", () => {
  assert.deepEqual(gate("bindings").args, ["run", "-p", "wf-bindings", "--locked", "--", "--check"]);
});

test("deny checks licences, bans and sources offline; advisories only in CI", () => {
  assert.deepEqual(gate("deny").args, ["deny", "--locked", "check", "licenses", "bans", "sources"]);
  assert.deepEqual(gate("advisories").args, ["deny", "--locked", "check", "advisories"]);
  assert.deepEqual(
    RUST_GATES.filter((g) => g.ciOnly).map((g) => g.name),
    ["advisories"],
  );
});

test("plugins probed are exactly the non-built-in subcommands the gates call", () => {
  const builtIn = new Set(["fmt", "clippy", "test", "run"]);
  const plugins = [...new Set(RUST_GATES.map((g) => g.args[0]))].filter((s) => !builtIn.has(s));
  assert.deepEqual([...CARGO_PLUGINS].sort(), plugins.sort());
});

test("list is frozen", () => {
  assert.ok(Object.isFrozen(RUST_GATES));
  for (const g of RUST_GATES) assert.ok(Object.isFrozen(g), `${g.name} not frozen`);
});
