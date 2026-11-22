import assert from "node:assert/strict";
import { test } from "node:test";
import { MemorySink } from "../infrastructure/memory-sink";
import { SETTINGS_PATH, updateSettingsDoc } from "../infrastructure/settings-json-doc";

test("settings.json: a change made between the read and the rename is re-merged, not overwritten", async () => {
  const sink = new MemorySink();
  await sink.write(SETTINGS_PATH, JSON.stringify({ keep: 1 }));
  const base = sink.write.bind(sink);
  let raced = false;
  const racy = Object.assign(sink, {
    write: async (path: string, text: string) => {
      // Another writer lands between this write's read and its rename, once.
      if (path.endsWith(".part") && !raced) {
        raced = true;
        await base(SETTINGS_PATH, JSON.stringify({ keep: 1, other: "x" }));
      }
      return base(path, text);
    },
  });
  await updateSettingsDoc(racy, "test", (doc) => {
    doc.added = 2;
  });
  assert.deepEqual(JSON.parse(await sink.readText(SETTINGS_PATH)), { keep: 1, other: "x", added: 2 });
});

test("settings.json: a file that keeps changing gives up after 3 tries with a fixed code", async () => {
  const sink = new MemorySink();
  await sink.write(SETTINGS_PATH, JSON.stringify({ keep: 1 }));
  const base = sink.write.bind(sink);
  let tries = 0;
  const churning = Object.assign(sink, {
    write: async (path: string, text: string) => {
      if (path.endsWith(".part")) await base(SETTINGS_PATH, JSON.stringify({ keep: 1, n: ++tries }));
      return base(path, text);
    },
  });
  let mutations = 0;
  await assert.rejects(
    updateSettingsDoc(churning, "test", () => {
      mutations += 1;
    }),
    (err: Error & { code?: string }) => {
      assert.equal(err.message, "settings.json changed during the save");
      assert.equal(err.code, "settings-changed");
      return true;
    },
  );
  assert.equal(mutations, 3);
});
