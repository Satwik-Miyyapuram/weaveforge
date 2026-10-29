/**
 * Parity harness for the Rust port. A case pairs the old TS function with its
 * Rust replacement; each fixture feeds both the same JSON input. They must give
 * deeply equal output, and equal `expected` when the fixture has one (golden).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

export interface ParityCase<I = unknown, O = unknown> {
  /** Also the fixture directory name under parity/fixtures/. */
  name: string;
  ts: (input: I) => O;
  rust: (input: I) => O;
}

export interface Fixture {
  file: string;
  input: unknown;
  expected?: unknown;
}

/** null when both sides agree (and match `expected`), else a one-line message. */
export function compareFixture<I, O>(c: ParityCase<I, O>, f: Fixture): string | null {
  const ts = c.ts(f.input as I);
  const rust = c.rust(f.input as I);
  if (!isDeepStrictEqual(ts, rust)) {
    return `${c.name}/${f.file}: ts ${JSON.stringify(ts)}, rust ${JSON.stringify(rust)}`;
  }
  if ("expected" in f && !isDeepStrictEqual(ts, f.expected)) {
    return `${c.name}/${f.file}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(ts)}`;
  }
  return null;
}

export function loadFixtures(fixturesDir: string, caseName: string): Fixture[] {
  const dir = path.join(fixturesDir, caseName);
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const data = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Record<string, unknown>;
      if (!("input" in data)) throw new Error(`${caseName}/${file} has no "input"`);
      return { file, input: data.input, ...("expected" in data ? { expected: data.expected } : {}) };
    });
}
