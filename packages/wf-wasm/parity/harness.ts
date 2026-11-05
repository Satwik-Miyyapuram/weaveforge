/**
 * Parity harness for the Rust port. Fixtures are frozen goldens from the deleted
 * TS. A case compares Rust against `expected`, and against a live `reference`
 * where one still exists.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

export interface ParityCase<I = unknown, O = unknown> {
  /** Also the fixture directory name under parity/fixtures/. */
  name: string;
  rust: (input: I) => O;
  /** A live reference implementation; without one, every fixture needs `expected`. */
  reference?: (input: I) => O;
}

export interface Fixture {
  file: string;
  input: unknown;
  expected?: unknown;
}

/** null when the case passes this fixture, else a one-line message. */
export function compareFixture<I, O>(c: ParityCase<I, O>, f: Fixture): string | null {
  const rust = c.rust(f.input as I);
  if (c.reference) {
    const ref = c.reference(f.input as I);
    if (!isDeepStrictEqual(ref, rust)) {
      return `${c.name}/${f.file}: reference ${JSON.stringify(ref)}, rust ${JSON.stringify(rust)}`;
    }
  } else if (!("expected" in f)) {
    return `${c.name}/${f.file}: no reference and no expected`;
  }
  if ("expected" in f && !isDeepStrictEqual(rust, f.expected)) {
    return `${c.name}/${f.file}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(rust)}`;
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
