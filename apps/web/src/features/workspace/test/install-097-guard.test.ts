import assert from "node:assert/strict";
import { test } from "node:test";
import { install097Required, install097RequiredFrom } from "../application/install-097-guard";

test("install097Required blocks only when legacy DB is present and no verified report", () => {
  assert.equal(install097Required({ legacyDbPresent: true, reportPresent: false }), true);
  assert.equal(install097Required({ legacyDbPresent: true, reportPresent: null }), true);
  assert.equal(install097Required({ legacyDbPresent: true, reportPresent: true }), false);
  assert.equal(install097Required({ legacyDbPresent: false, reportPresent: false }), false);
  assert.equal(install097Required({ legacyDbPresent: false, reportPresent: null }), false);
});

test("no desktop bridge (browser, Android): open", async () => {
  assert.equal(await install097RequiredFrom(null), false);
});

test("desktop shell without legacyDbPresent: unknown, blocked (fail closed)", async () => {
  assert.equal(await install097RequiredFrom({}), true);
  assert.equal(await install097RequiredFrom({ migrationReportPresent: async () => true }), true);
});

test("legacy false: open, even with report method absent", async () => {
  assert.equal(await install097RequiredFrom({ legacyDbPresent: async () => false }), false);
});

test("legacy true and report true: open", async () => {
  const bridge = {
    legacyDbPresent: async () => true,
    migrationReportPresent: async () => true,
  };
  assert.equal(await install097RequiredFrom(bridge), false);
});

test("legacy true and report false: blocked", async () => {
  const bridge = {
    legacyDbPresent: async () => true,
    migrationReportPresent: async () => false,
  };
  assert.equal(await install097RequiredFrom(bridge), true);
});

test("legacy true and report method absent (unknown): blocked, fail closed", async () => {
  assert.equal(await install097RequiredFrom({ legacyDbPresent: async () => true }), true);
});

test("legacy true and report throws (unknown): blocked, fail closed", async () => {
  const bridge = {
    legacyDbPresent: async () => true,
    migrationReportPresent: async () => {
      throw new Error("bridge down");
    },
  };
  assert.equal(await install097RequiredFrom(bridge), true);
});

test("legacy throws: unknown, blocked (fail closed)", async () => {
  const bridge = {
    legacyDbPresent: async () => {
      throw new Error("bridge down");
    },
    migrationReportPresent: async () => false,
  };
  assert.equal(await install097RequiredFrom(bridge), true);
});
