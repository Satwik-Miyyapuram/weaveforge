import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CURRENT_DISCLAIMER_VERSION,
  needsDisclaimerAcceptance,
} from "../src/features/settings/domain/privacy-disclaimer.js";

test("needsDisclaimerAcceptance requires first accept", () => {
  assert.equal(needsDisclaimerAcceptance({}), true);
});

test("needsDisclaimerAcceptance treats missing version as v1", () => {
  assert.equal(
    needsDisclaimerAcceptance({ disclaimerAcceptedAt: "2024-01-01T00:00:00.000Z" }),
    CURRENT_DISCLAIMER_VERSION > 1,
  );
});

test("needsDisclaimerAcceptance passes at current version", () => {
  assert.equal(
    needsDisclaimerAcceptance({
      disclaimerAcceptedAt: "2026-01-01T00:00:00.000Z",
      disclaimerVersion: CURRENT_DISCLAIMER_VERSION,
    }),
    false,
  );
});

test("needsDisclaimerAcceptance fails on stale version", () => {
  assert.equal(
    needsDisclaimerAcceptance({
      disclaimerAcceptedAt: "2026-01-01T00:00:00.000Z",
      disclaimerVersion: CURRENT_DISCLAIMER_VERSION - 1,
    }),
    true,
  );
});
