import assert from "node:assert/strict";
import { test } from "node:test";

import { wiringNeedsReload } from "../wiring-key";

const folder = "C:/Users/me/WeaveForge";

test("a folder change makes the built wiring stale", () => {
  assert.equal(wiringNeedsReload({ folder, migration: "none" }, { folder: "D:/Other", migration: "none" }), true);
  assert.equal(wiringNeedsReload({ folder: null, migration: undefined }, { folder, migration: undefined }), true);
});

test("migration reaching verified makes the built wiring stale", () => {
  assert.equal(wiringNeedsReload({ folder, migration: "incomplete" }, { folder, migration: "verified" }), true);
  assert.equal(wiringNeedsReload({ folder, migration: "unavailable" }, { folder, migration: "verified" }), true);
});

test("no change, or a move away from verified, keeps the built wiring", () => {
  assert.equal(wiringNeedsReload({ folder, migration: "verified" }, { folder, migration: "verified" }), false);
  assert.equal(wiringNeedsReload({ folder, migration: "none" }, { folder, migration: "none" }), false);
  assert.equal(wiringNeedsReload({ folder, migration: "verified" }, { folder, migration: "incomplete" }), false);
});
