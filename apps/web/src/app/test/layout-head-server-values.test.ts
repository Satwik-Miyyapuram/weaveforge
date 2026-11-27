/**
 * Values the root layout puts in `<head>` must come from server modules. A
 * value imported from a "use client" module reaches the client as a lazy
 * reference; when its chunk is late, hydration suspends inside `<head>` and
 * React mis-hydrates the body (#418), re-rendering the whole app at startup.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const SRC = join(__dirname, "..", "..");

/** Resolves an `@/` or `./` import of layout.tsx to its source file. */
function resolve(spec: string): string {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : join(SRC, "app", spec);
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(base + ext)) return base + ext;
  throw new Error(`cannot resolve ${spec}`);
}

test("layout <head> values come from modules without \"use client\"", () => {
  const layout = readFileSync(join(SRC, "app", "layout.tsx"), "utf8");
  const head = layout.slice(layout.indexOf("<head>"), layout.indexOf("</head>"));
  const used = [...head.matchAll(/__html:\s*([A-Z_]+)/g)].map((m) => m[1] ?? "");
  assert.ok(used.length >= 2, "expected the boot scripts in <head>");
  for (const name of used) {
    const imp = [...layout.matchAll(/import \{([^}]*)\} from "([^"]+)"/g)].find((m) => (m[1] ?? "").split(",").some((n) => n.trim() === name));
    assert.ok(imp, `${name} is not imported`);
    const file = resolve(imp[2] ?? "");
    assert.doesNotMatch(readFileSync(file, "utf8").slice(0, 200), /^\s*["']use client["']/, `${name} comes from client module ${imp[2]}`);
  }
});
