import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The project Connections panel (git, plan integrations, Mattermost) is not offline sync: settings must still render it. */
const src = readFileSync(fileURLToPath(new URL("../../settings/ui/settings-screen.tsx", import.meta.url)), "utf8");

test("settings still imports the Connections panel from features/sync", () => {
  assert.match(src, /import \{ SyncSettings \} from "@\/features\/sync";/);
});

test("settings still renders <SyncSettings /> in the sync tabpanel", () => {
  assert.match(src, /<SyncSettings \/>/);
});
