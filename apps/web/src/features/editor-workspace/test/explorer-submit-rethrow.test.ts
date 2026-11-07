/**
 * The name box reopens for a retry only when its submit rejects. The panel's
 * create and rename handlers caught the error to show it and then resolved, so
 * after a failed create Enter did nothing. They show the error and rethrow.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../ui/explorer-panel.tsx", import.meta.url)), "utf8");

for (const name of ["submitDraft", "submitRename"]) {
  test(`${name} rethrows after showing the error`, () => {
    const body = src.slice(src.indexOf(`const ${name} = useCallback(`)).split("useCallback(")[1] ?? "";
    assert.match(body, /catch \(error\) \{\s*setProblem\(\{[^}]*\}\);\s*(\/\/.*\s*)?throw error;\s*\}/);
  });
}
