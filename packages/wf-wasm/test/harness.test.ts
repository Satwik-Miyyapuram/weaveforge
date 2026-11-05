import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareFixture, loadFixtures, type ParityCase } from "../parity/harness.js";

const double: ParityCase<number, number> = { name: "double", reference: (n) => n * 2, rust: (n) => n + n };
const broken: ParityCase<number, number> = { name: "broken", reference: (n) => n * 2, rust: (n) => n * 3 };
const golden: ParityCase<number, number> = { name: "golden", rust: (n: number) => n + 1 };

test("compareFixture passes when reference and Rust agree", () => {
  assert.equal(compareFixture(double, { file: "a.json", input: 2 }), null);
});

test("compareFixture reports a reference/Rust mismatch with both outputs", () => {
  assert.equal(compareFixture(broken, { file: "a.json", input: 2 }), "broken/a.json: reference 4, rust 6");
});

test("compareFixture checks expected against Rust", () => {
  assert.equal(compareFixture(double, { file: "a.json", input: 2, expected: 4 }), null);
  assert.equal(compareFixture(double, { file: "a.json", input: 2, expected: 5 }), "double/a.json: expected 5, got 4");
});

test("compareFixture a golden-only case compares Rust against expected", () => {
  assert.equal(compareFixture(golden, { file: "a.json", input: 1, expected: 2 }), null);
  assert.equal(compareFixture(golden, { file: "a.json", input: 1, expected: 3 }), "golden/a.json: expected 3, got 2");
});

test("compareFixture a golden-only fixture with no expected is an error", () => {
  assert.equal(compareFixture(golden, { file: "a.json", input: 1 }), "golden/a.json: no reference and no expected");
});

test("compareFixture compares structure, not key order", () => {
  const c: ParityCase<null, unknown> = { name: "obj", reference: () => ({ a: 1, b: 2 }), rust: () => ({ b: 2, a: 1 }) };
  assert.equal(compareFixture(c, { file: "o.json", input: null }), null);
});

test("loadFixtures reads every .json in a case directory, sorted", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "parity-"));
  mkdirSync(path.join(dir, "double"));
  writeFileSync(path.join(dir, "double", "b.json"), JSON.stringify({ input: 3, expected: 6 }));
  writeFileSync(path.join(dir, "double", "a.json"), JSON.stringify({ input: 1 }));
  writeFileSync(path.join(dir, "double", "notes.txt"), "ignored");
  assert.deepEqual(loadFixtures(dir, "double"), [
    { file: "a.json", input: 1 },
    { file: "b.json", input: 3, expected: 6 },
  ]);
});

test("loadFixtures rejects a fixture with no input key", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "parity-"));
  mkdirSync(path.join(dir, "x"));
  writeFileSync(path.join(dir, "x", "bad.json"), JSON.stringify({ expected: 1 }));
  assert.throws(() => loadFixtures(dir, "x"), /x\/bad\.json has no "input"/);
});
