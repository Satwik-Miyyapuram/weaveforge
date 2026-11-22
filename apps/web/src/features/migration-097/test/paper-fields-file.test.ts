import assert from "node:assert/strict";
import { test } from "node:test";
import { defsFromSettings, defsToSettings, fieldsToValues, valuesToFields } from "../domain/paper-fields-file";
import type { Row } from "../domain/ports";

// Shapes as listRows returns them (camelCase) and as the server holds them.
const DEFS: Row[] = [
  { id: "f1", projectId: "proj-a", name: "Venue", kind: "text", options: [], sortOrder: 0 },
  { id: "f2", projectId: "proj-a", name: "Score", kind: "number", options: [], sortOrder: 1 },
  { id: "f3", projectId: "proj-a", name: "Topics", kind: "multi_select", options: ["nlp", "vision"], sortOrder: 2 },
];
/** Server project id to the folder its repos sit in ("" = workspace root). */
const FOLDERS = new Map([["proj-a", "Thesis"]]);

const VALUES: Row[] = [
  { id: "server-uuid-1", paperId: "p1", fieldId: "f1", value: "NeurIPS" },
  { id: "server-uuid-2", paperId: "p1", fieldId: "f2", value: 4.5 },
  { id: "server-uuid-3", paperId: "p2", fieldId: "f3", value: ["nlp"] },
];

/** The file keeps the paper, the field and the value. Server row ids are not part of the file. */
function fieldEqual(rows: Row[]): unknown[] {
  return rows
    .map((r) => ({ paperId: r.paperId, fieldId: r.fieldId, value: r.value }))
    .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
}

function defEqual(rows: Row[]): unknown[] {
  return rows
    .map((r) => ({ id: r.id, projectId: r.projectId, name: r.name, kind: r.kind, options: r.options, sortOrder: r.sortOrder }))
    .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
}

test("definitions: settings paperFields is keyed by id, each def tagged with its project folder, and reads back field-equal", () => {
  const settings = JSON.parse(JSON.stringify(defsToSettings(DEFS, FOLDERS)));
  assert.deepEqual(settings, {
    f1: { projectId: "Thesis", name: "Venue", kind: "text", options: [], sortOrder: 0 },
    f2: { projectId: "Thesis", name: "Score", kind: "number", options: [], sortOrder: 1 },
    f3: { projectId: "Thesis", name: "Topics", kind: "multi_select", options: ["nlp", "vision"], sortOrder: 2 },
  });
  assert.deepEqual(defEqual(defsFromSettings(settings, new Map([["Thesis", "proj-a"]]))), defEqual(DEFS));
});

test("definitions: two projects with the same field name stay scoped to their own folder", () => {
  const twoProjects: Row[] = [
    { id: "fa", projectId: "proj-a", name: "Venue", kind: "text", options: [], sortOrder: 0 },
    { id: "fb", projectId: "proj-b", name: "Venue", kind: "text", options: [], sortOrder: 0 },
  ];
  const folders = new Map([
    ["proj-a", "Thesis"],
    ["proj-b", ""],
  ]);
  const settings = defsToSettings(twoProjects, folders);
  assert.equal(settings.fa?.projectId, "Thesis");
  assert.equal(settings.fb?.projectId, "");
  const thesisOnly = Object.entries(settings).filter(([, d]) => d.projectId === "Thesis").map(([id]) => id);
  assert.deepEqual(thesisOnly, ["fa"]);
});

test("definitions: a def whose project has no folder is refused, not written to the workspace root", () => {
  assert.throws(
    () => defsToSettings([{ id: "fz", projectId: "proj-z", name: "X", kind: "text", options: [], sortOrder: 0 }], FOLDERS),
    /no folder/,
  );
});

test("values: fields are keyed by field id per paper, the value id is paper:field, and it reads back field-equal", () => {
  const stored = JSON.parse(JSON.stringify(Object.fromEntries(valuesToFields(VALUES))));
  assert.deepEqual(stored, { p1: { f1: "NeurIPS", f2: 4.5 }, p2: { f3: ["nlp"] } });

  const back = fieldsToValues(new Map(Object.entries(stored)));
  assert.deepEqual(back.map((v) => v.id).sort(), ["p1:f1", "p1:f2", "p2:f3"]);
  assert.deepEqual(fieldEqual(back), fieldEqual(VALUES));
});

test("values: a value that is not text, a number or a text list is refused, not coerced", () => {
  assert.throws(
    () => valuesToFields([{ id: "x", paperId: "p1", fieldId: "f1", value: { nested: true } }]),
    /not text, a number or a text list/,
  );
  assert.throws(
    () => valuesToFields([{ id: "y", paperId: "p1", fieldId: "f1", value: true }]),
    /not text, a number or a text list/,
  );
});
