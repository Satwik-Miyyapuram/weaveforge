import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initSync } from "../src/index.js";
import { CASES } from "../parity/cases.js";
import { compareFixture, loadFixtures } from "../parity/harness.js";

initSync({ module: readFileSync(new URL("../pkg/wf_wasm_bg.wasm", import.meta.url)) });
const fixturesDir = fileURLToPath(new URL("../parity/fixtures/", import.meta.url));

test("every case has fixtures and every fixture directory has a case", () => {
  const dirs = readdirSync(fixturesDir).sort();
  assert.deepEqual(dirs, CASES.map((c) => c.name).sort());
  for (const c of CASES) {
    assert.ok(loadFixtures(fixturesDir, c.name).length > 0, `${c.name} has no fixtures`);
  }
});

for (const c of CASES) {
  for (const fixture of loadFixtures(fixturesDir, c.name)) {
    test(`parity ${c.name}/${fixture.file}`, () => {
      assert.equal(compareFixture(c, fixture), null);
    });
  }
}
