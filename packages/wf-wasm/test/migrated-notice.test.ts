import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { migratedNotice } from "../src/index.js";
import { initSync } from "../src/index.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

test("migratedNotice is null with no marker and dated when the marker has a date", () => {
  assert.equal(migratedNotice(null), null);
  const notice = migratedNotice('{"at":"2026-10-30T08:00:00.000Z"}');
  assert.ok(notice?.includes(" on 2026-10-30."));
  assert.ok(migratedNotice("not json")?.includes("new WeaveForge app. "));
});
