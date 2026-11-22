import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// 0.9.8 has no local database. The web app's production code must not read the
// desktop shell's local-DB state, offer a reset, or drop the folder over a lost
// database. Test files are skipped: they describe the old surface until removed.
const SRC = fileURLToPath(new URL("../../../", import.meta.url));
const BANNED = [
  "localDbState",
  "resetLocalDb",
  "DesktopLocalDbState",
  "folder-lost-db-guard",
  "lost-db-notice",
  "LostDbNotice",
  "folderWriteBlockedByLostDb",
  "LOST_DB_SYNC_MESSAGE",
  "useDatabaseLocation",
];

function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : productionFiles(full);
    if (!/\.tsx?$/.test(entry.name) || /\.test\./.test(entry.name)) return [];
    return [full];
  });
}

test("production web code has no local-DB state reads or lost-DB guard", () => {
  const hits: string[] = [];
  for (const file of productionFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const banned of BANNED) {
      if (source.includes(banned)) hits.push(`${relative(SRC, file).split(sep).join("/")}: ${banned}`);
    }
  }
  assert.deepEqual(hits, []);
});
