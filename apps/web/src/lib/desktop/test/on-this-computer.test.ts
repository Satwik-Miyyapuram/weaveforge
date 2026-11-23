/**
 * The sign-in screen offers "on this computer" whenever the desktop bridge is present, not because
 * a local database call exists. A browser never has the bridge; the desktop app always does, even
 * after the local database is retired.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { desktop } from "../desktop-bridge";

const g = globalThis as { window?: unknown };
const original = g.window;
after(() => { g.window = original; });

test("a browser has no bridge, so the offer is not made", () => {
  g.window = {};
  assert.equal(desktop() !== null, false);
});

test("the desktop app offers it without any local-database member", () => {
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}) } };
  assert.equal(desktop() !== null, true);
});

test("a half-initialised bridge with no fetchTitle does not offer it", () => {
  g.window = { weaveforge: { pickFolder: () => Promise.resolve(null) } };
  assert.equal(desktop() !== null, false);
});
