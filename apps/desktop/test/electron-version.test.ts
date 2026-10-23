/**
 * The pinned Electron carries every published security fix for its major line.
 *
 * GHSA-jr5w-w6x2-84p9 (2026-10-22, high): compromised eMudhra intermediate
 * certificates. Electron blocks them in Chromium networking and Node's tls,
 * https and fetch from 44.9.1; earlier versions let an attacker on the network
 * impersonate a TLS server, and the app talks TLS to its API and sign-in.
 * Add a row when a new advisory lands; the test fails until the pin catches up.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Major line → first version with every advisory fixed. */
const PATCHED: Record<number, string> = {
  44: "44.9.1", // GHSA-jr5w-w6x2-84p9
};

const parse = (v: string): [number, number, number] => {
  const [major = 0, minor = 0, patch = 0] = v.split(".").map((n) => Number.parseInt(n, 10));
  return [major, minor, patch];
};

function atLeast(version: string, min: string): boolean {
  const rank = ([major, minor, patch]: [number, number, number]) => (major * 1e4 + minor) * 1e4 + patch;
  return rank(parse(version)) >= rank(parse(min));
}

test("the pinned Electron includes the latest security fixes for its major", () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  const pinned: string = pkg.devDependencies?.electron ?? pkg.dependencies?.electron;
  assert.match(pinned, /^\d+\.\d+\.\d+$/, "electron is pinned to an exact version");
  const min = PATCHED[parse(pinned)[0]];
  assert.ok(min, `no advisory row for Electron ${parse(pinned)[0]}: check the advisories and add one`);
  assert.ok(atLeast(pinned, min), `Electron ${pinned} is below ${min}`);
});
