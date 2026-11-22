import assert from "node:assert/strict";
import { test } from "node:test";
import { MemorySink } from "../infrastructure/memory-sink";
import { SETTINGS_PATH, updateSettingsDoc } from "../infrastructure/settings-json-doc";

test("settings.json: a change made between the read and the rename is re-merged, not overwritten", async () => {
  const sink = new MemorySink();
  await sink.write(SETTINGS_PATH, JSON.stringify({ keep: 1 }));
  const baseWrite = sink.write.bind(sink);
  const baseWriteIf = sink.writeIf.bind(sink);
  let raced = false;
  const racy = Object.assign(sink, {
    writeIf: async (path: string, text: string, expected: string) => {
      // Another writer lands between this save's read and its compare-and-set, once.
      if (path === SETTINGS_PATH && !raced) {
        raced = true;
        await baseWrite(SETTINGS_PATH, JSON.stringify({ keep: 1, other: "x" }));
      }
      return baseWriteIf(path, text, expected);
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
  const baseWrite = sink.write.bind(sink);
  const baseWriteIf = sink.writeIf.bind(sink);
  let tries = 0;
  const churning = Object.assign(sink, {
    writeIf: async (path: string, text: string, expected: string) => {
      // Every save finds the file changed under it.
      if (path === SETTINGS_PATH) await baseWrite(SETTINGS_PATH, JSON.stringify({ keep: 1, n: ++tries }));
      return baseWriteIf(path, text, expected);
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

test("settings.json: creating it never touches a user's own settings.json.part", async () => {
  const sink = new MemorySink();
  await sink.write(`${SETTINGS_PATH}.part`, "USER");
  await updateSettingsDoc(sink, "test", (doc) => {
    doc.added = 1;
  });
  assert.equal(await sink.readText(`${SETTINGS_PATH}.part`), "USER", "the user's .part file is kept");
  assert.deepEqual(JSON.parse(await sink.readText(SETTINGS_PATH)), { added: 1 });
});
