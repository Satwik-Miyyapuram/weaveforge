import assert from "node:assert/strict";
import test from "node:test";
import { buildMeta, installMeta } from "../meta";

test("meta names the project and the app, and asks for English", () => {
  const meta = buildMeta({ projectId: "0123456789abcdef01234567" });
  assert.equal(meta["ol-project_id"], "0123456789abcdef01234567");
  assert.deepEqual(meta["ol-i18n"], { currentLangCode: "en" });
  assert.equal(meta["ol-ExposedSettings"].appName, "WeaveForge");
  assert.equal(meta["ol-anonymous"], false);
});

test("meta carries no Overleaf secrets", () => {
  const meta = buildMeta({ projectId: "p" }) as Record<string, unknown>;
  assert.equal("ol-csrfToken" in meta, false);
});

test("meta keeps the editor on plain ShareJS ops and off server features", () => {
  const meta = buildMeta({ projectId: "p" });
  assert.equal(meta["ol-otMigrationStage"], 0);
  assert.deepEqual(meta["ol-capabilities"], []);
  assert.equal("ol-preventCompileOnLoad" in meta, false, "compiles on open, as on Overleaf");
  assert.deepEqual(meta["ol-splitTestVariants"], {});
});

test("installMeta fills the cache getMeta reads, replacing a previous project", () => {
  const cache = new Map<string, unknown>([["ol-project_id", "old"], ["ol-other", 1]]);
  installMeta(buildMeta({ projectId: "new" }), cache);
  assert.equal(cache.get("ol-project_id"), "new");
  assert.equal(cache.get("ol-other"), 1);
  assert.equal(cache.get("ol-ExposedSettings") !== undefined, true);
});
