import { test } from "node:test";
import assert from "node:assert/strict";
import { editedLabel } from "../lib/edited-label";

const now = new Date("2026-09-26T12:00:00Z");

test("no timestamp shows nothing", () => {
  assert.equal(editedLabel(undefined, now), null);
  assert.equal(editedLabel("not a date", now), null);
});

test("recent edits read as minutes, hours and days", () => {
  assert.equal(editedLabel("2026-09-26T11:59:30Z", now), "edited just now");
  assert.equal(editedLabel("2026-09-26T11:15:00Z", now), "edited 45m ago");
  assert.equal(editedLabel("2026-09-26T07:00:00Z", now), "edited 5h ago");
  assert.equal(editedLabel("2026-09-23T12:00:00Z", now), "edited 3d ago");
  assert.match(editedLabel("2026-08-01T12:00:00Z", now) ?? "", /^edited \S/);
});
