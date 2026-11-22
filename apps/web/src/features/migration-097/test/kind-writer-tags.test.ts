import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { MemorySink } from "../infrastructure/memory-sink";
import { createTagsWriter } from "../infrastructure/kind-writer-tags";
import { loadCore } from "@/lib/rust-core";

before(async () => {
  await loadCore(readFileSync(new URL("../../../../../../packages/wf-wasm/pkg/wf_wasm_bg.wasm", import.meta.url)));
});

test("tag colour written through the writer reads back field-equal", async () => {
  const sink = new MemorySink();
  const writer = createTagsWriter(sink);
  await writer.write("tags", { id: "ml", name: "ml", color: "#ff0000" });
  const rows = await writer.readBack("tags");
  assert.deepEqual(
    rows.map((r) => ({ id: r.id, name: r.name, color: r.color })),
    [{ id: "ml", name: "ml", color: "#ff0000" }],
  );
});

test("tag colour survives a reopen of the same sink (settings.json persisted)", async () => {
  const sink = new MemorySink();
  await createTagsWriter(sink).write("tags", { id: "ml", name: "ml", color: "#00ff00" });
  const rows = await createTagsWriter(sink).readBack("tags");
  assert.equal(rows[0]?.color, "#00ff00");
});

test("unknown kind is rejected", async () => {
  const writer = createTagsWriter(new MemorySink());
  await assert.rejects(() => writer.write("notes", { id: "x" }));
});

test("a corrupt settings.json is not treated as empty: write throws and the file is left as it was", async () => {
  const sink = new MemorySink();
  await sink.write(".weaveforge/settings.json", "{not json");
  const writer = createTagsWriter(sink);
  await assert.rejects(() => writer.write("tags", { id: "ml", name: "ml", color: "#ff0000" }));
  assert.equal(await sink.readText(".weaveforge/settings.json"), "{not json");
});
