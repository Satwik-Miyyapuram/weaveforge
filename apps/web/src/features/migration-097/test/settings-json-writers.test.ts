import assert from "node:assert/strict";
import { test } from "node:test";
import { createPaperFieldsWriter } from "../infrastructure/kind-writer-paper-fields";
import { createTagsWriter } from "../infrastructure/kind-writer-tags";
import { defsToSettings } from "../domain/paper-fields-file";
import type { Row } from "../domain/ports";
import { MemorySink } from "../infrastructure/memory-sink";

const SETTINGS = ".weaveforge/settings.json";
const FOLDERS = new Map([["proj-a", "Thesis"]]);
const DEF_A: Row = { id: "fa", projectId: "proj-a", name: "Venue", kind: "text", options: [], sortOrder: 0 };
const DEF_B: Row = { id: "fb", projectId: "proj-a", name: "Score", kind: "number", options: [], sortOrder: 1 };
const TAG_1: Row = { id: "t1", name: "Method", color: "#f00" };
const TAG_2: Row = { id: "t2", name: "Result", color: "#0f0" };

async function settingsOf(sink: MemorySink): Promise<Record<string, unknown>> {
  return JSON.parse(await sink.readText(SETTINGS)) as Record<string, unknown>;
}

/** Fresh writer instances, so the check reads what is on disk and not a writer's memory. */
async function tagIds(sink: MemorySink): Promise<string[]> {
  return (await createTagsWriter(sink).readBack("tags")).map((t) => String(t.id)).sort();
}

async function paperFieldDefs(sink: MemorySink): Promise<unknown> {
  return (await settingsOf(sink)).paperFields;
}

test("settings.json: tags written before and after a paperFields write keep the paperFields", async () => {
  const sink = new MemorySink();
  const tags = createTagsWriter(sink);
  const fields = createPaperFieldsWriter(sink, FOLDERS);
  await tags.write("tags", TAG_1);
  await fields.write("paperFields", DEF_A);
  await tags.write("tags", TAG_2);
  assert.deepEqual(await paperFieldDefs(sink), defsToSettings([DEF_A], FOLDERS));
  assert.deepEqual(await tagIds(sink), ["method", "result"]);
});

test("settings.json: a paperFields write after a tags write keeps the tags", async () => {
  const sink = new MemorySink();
  const tags = createTagsWriter(sink);
  const fields = createPaperFieldsWriter(sink, FOLDERS);
  await fields.write("paperFields", DEF_A);
  await tags.write("tags", TAG_1);
  await fields.write("paperFields", DEF_B);
  assert.deepEqual(await paperFieldDefs(sink), defsToSettings([DEF_A, DEF_B], FOLDERS));
  assert.deepEqual(await tagIds(sink), ["method"]);
});
