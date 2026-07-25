import assert from "node:assert/strict";
import test from "node:test";
import { resolveAppConfig } from "../app-config";

test("deployment config can allowlist built-in integrations", () => {
  const resolved = resolveAppConfig({ builtins: { integrations: ["zotero"] }, plugins: [] });
  assert.deepEqual(resolved.integrationManifests.all.map((manifest) => manifest.id), ["zotero"]);
});

test("deployment config can allowlist built-in feature ids", () => {
  const resolved = resolveAppConfig({ builtins: { features: ["dashboard", "papers"] }, plugins: [] });
  assert.deepEqual(resolved.enabledBuiltinFeatureIds, ["dashboard", "papers"]);
});
