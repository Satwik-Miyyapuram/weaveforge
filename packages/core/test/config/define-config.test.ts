import { test } from "node:test";
import assert from "node:assert/strict";
import { defineConfig } from "../../src/config/define-config.js";

test("defineConfig returns the same object", () => {
  const cfg = defineConfig({ plugins: [{ id: "demo" }] });
  assert.equal(cfg.plugins?.[0]?.id, "demo");
});
