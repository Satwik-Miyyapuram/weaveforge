import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FilePaperFieldRepository, type FieldedPapers } from "@/backend/providers/files/file-paper-field-repo";
import type { SettingsSection } from "@/backend/providers/files/file-tag-repo";
import { defsToSettings, valuesToFields, type FileFieldValue } from "../domain/paper-fields-file";
import type { Row } from "../domain/ports";
import { MemorySink } from "../infrastructure/memory-sink";
import { sinkAsWorkspaceFs } from "../infrastructure/sink-workspace-fs";

before(loadTestCore);

const SETTINGS = ".weaveforge/settings.json";

// Two projects, each with a field named "Venue": the ids differ, so the defs must stay scoped.
const DEFS: Row[] = [
  { id: "fa", projectId: "proj-a", name: "Venue", kind: "text", options: [], sortOrder: 0 },
  { id: "fa2", projectId: "proj-a", name: "Score", kind: "number", options: [], sortOrder: 1 },
  { id: "fb", projectId: "proj-b", name: "Venue", kind: "text", options: ["ICML"], sortOrder: 0 },
];
const FOLDERS = new Map([
  ["proj-a", "Thesis"],
  ["proj-b", ""],
]);
const VALUES: Row[] = [
  { id: "v1", paperId: "p1", fieldId: "fa", value: "NeurIPS" },
  { id: "v2", paperId: "p1", fieldId: "fa2", value: 4.5 },
  { id: "v3", paperId: "p2", fieldId: "fb", value: "ICML" },
];

/** Settings over the parsed settings.json, with the get/set path semantics the File repos use. */
function settingsOver(doc: Record<string, unknown>): SettingsSection {
  return {
    get: (key) => key.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), doc),
    set: (key, value) => {
      let o = doc;
      for (const k of key.slice(0, -1)) {
        o[k] ??= {};
        o = o[k] as Record<string, unknown>;
      }
      const last = key[key.length - 1] as string;
      if (value === undefined) delete o[last];
      else o[last] = value;
    },
  };
}

/** Papers as the File paper repo sees them: each paper's fields frontmatter, keyed by field id. */
function papersWith(fields: Map<string, Record<string, FileFieldValue>>): FieldedPapers {
  return {
    listExtras: async () => [...fields].map(([paperId, f]) => ({ paperId, extras: { fields: f } as never })),
    updateExtras: async (id, change) => {
      const current = { fields: fields.get(id) ?? {} };
      const next = await change(current as never);
      fields.set(id, ((next as { fields?: Record<string, FileFieldValue> }).fields ?? current.fields) as Record<string, FileFieldValue>);
      return true;
    },
  };
}

test("round trip: the exporter's settings.json and values, read through FilePaperFieldRepository per project", async () => {
  // The exporter writes settings.json (defs, tagged with their folder) and each paper's fields.
  const sink = new MemorySink();
  await sink.write(SETTINGS, JSON.stringify({ paperFields: defsToSettings(DEFS, FOLDERS) }));
  const doc = JSON.parse(await sink.readText(SETTINGS)) as Record<string, unknown>;
  const fields = valuesToFields(VALUES);
  const papers = papersWith(fields);
  const fs = sinkAsWorkspaceFs(sink);

  // Project a lives in "Thesis": it lists exactly its own two defs.
  const thesis = new FilePaperFieldRepository(papers, settingsOver(doc), fs, () => "Thesis");
  assert.deepEqual(await thesis.listDefs(), [
    { id: "fa", name: "Venue", kind: "text", options: [], sortOrder: 0 },
    { id: "fa2", name: "Score", kind: "number", options: [], sortOrder: 1 },
  ]);
  assert.deepEqual(
    (await thesis.listValuesForProject()).map((v) => [v.id, v.value]),
    [
      ["p1:fa", "NeurIPS"],
      ["p1:fa2", 4.5],
    ],
  );

  // Project b lives at the workspace root: its "Venue" is not project a's.
  const root = new FilePaperFieldRepository(papers, settingsOver(doc), fs, () => "");
  assert.deepEqual(await root.listDefs(), [{ id: "fb", name: "Venue", kind: "text", options: ["ICML"], sortOrder: 0 }]);
  assert.deepEqual((await root.listValuesForProject()).map((v) => [v.id, v.value]), [["p2:fb", "ICML"]]);
});
