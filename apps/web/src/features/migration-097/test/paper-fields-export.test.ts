import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { typedCore } from "@/lib/rust-core";
import { FilePaperFieldRepository } from "@/backend/providers/files/file-paper-field-repo";
import type { SettingsSection } from "@/backend/providers/files/file-tag-repo";
import type { KindWriter } from "../domain/kind-writer";
import { defsToSettings, projectDefsMismatches, type FileFieldValue } from "../domain/paper-fields-file";
import type { FileCodec, Row, ServerSource } from "../domain/ports";
import { runWebExport } from "../application/run-web-export";
import { createPaperFieldsWriter } from "../infrastructure/kind-writer-paper-fields";
import { createTagsWriter } from "../infrastructure/kind-writer-tags";
import { MemorySink } from "../infrastructure/memory-sink";
import { sinkAsWorkspaceFs } from "../infrastructure/sink-workspace-fs";

before(loadTestCore);

const NOW = "2026-11-22T00:00:00.000Z";
const SETTINGS = ".weaveforge/settings.json";

const DEFS: Row[] = [
  { id: "fa", projectId: "proj-a", name: "Venue", kind: "text", options: [], sortOrder: 0 },
  { id: "fa2", projectId: "proj-a", name: "Score", kind: "number", options: [], sortOrder: 1 },
  { id: "fb", projectId: "proj-b", name: "Venue", kind: "select", options: ["ICML"], sortOrder: 0 },
];
const FOLDERS = new Map([
  ["proj-a", "Thesis"],
  ["proj-b", ""],
]);
// p1 lives in Thesis (project a); p2 lives at the workspace root (project b).
const VALUES: Row[] = [
  { id: "v1", projectId: "proj-a", paperId: "p1", fieldId: "fa", value: "NeurIPS" },
  { id: "v2", projectId: "proj-a", paperId: "p1", fieldId: "fa2", value: 4.5 },
  { id: "v3", projectId: "proj-b", paperId: "p2", fieldId: "fb", value: "ICML" },
];

const NO_CODEC = {
  supports: () => false,
  toFile: () => {
    throw new Error("codec must not be used for paper fields");
  },
  toRow: () => {
    throw new Error("codec must not be used for paper fields");
  },
} as unknown as FileCodec;

function fakeSource(rows: Record<string, Row[]>): ServerSource {
  return {
    listRows: async (kind: string) => rows[kind] ?? [],
    listTrashed: async () => [],
    countRows: async (kind: string) => (rows[kind] ?? []).length,
    pendingOutbox: async () => 0,
    undecryptable: async () => 0,
    listBlobs: async () => [],
    fetchBlob: async () => new Uint8Array(),
    markExported097: async () => {},
  } as ServerSource;
}

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

async function readSettings(sink: MemorySink): Promise<Record<string, unknown>> {
  return JSON.parse(await sink.readText(SETTINGS)) as Record<string, unknown>;
}

/** Each project's defs, read back through FilePaperFieldRepository at its folder. */
async function listDefsPerProject(sink: MemorySink): Promise<Map<string, Row[]>> {
  const doc = await readSettings(sink);
  const fs = sinkAsWorkspaceFs(sink);
  const out = new Map<string, Row[]>();
  for (const [projectId, folder] of FOLDERS) {
    const { FilePaperRepository } = await import("@/features/papers/infrastructure/file-paper-repository");
    const repo = new FilePaperFieldRepository(new FilePaperRepository(fs, folder), settingsOver(doc), fs, () => folder);
    out.set(projectId, (await repo.listDefs()).map((d) => ({ ...d, projectId })));
  }
  return out;
}

const TERMS = { kinds: ["paperFields"], codec: NO_CODEC, now: NOW };

test("paper fields: defs for two projects land in settings.json per project folder and verify end to end", async () => {
  const sink = new MemorySink();
  const result = await runWebExport({
    ...TERMS,
    source: fakeSource({ paperFields: DEFS }),
    sink,
    writers: [createPaperFieldsWriter(sink, FOLDERS)],
  });
  assert.deepEqual(result.run.missing, []);
  assert.equal(result.state, "verified");
  assert.deepEqual((await readSettings(sink)).paperFields, defsToSettings(DEFS, FOLDERS));
  const back = await listDefsPerProject(sink);
  assert.deepEqual(back.get("proj-a")?.map((d) => d.id), ["fa", "fa2"]);
  assert.deepEqual(back.get("proj-b")?.map((d) => d.id), ["fb"]);
});

test("paper fields: a project whose defs read back changed is listed missing by its project id", async () => {
  const sink = new MemorySink();
  const base = createPaperFieldsWriter(sink, FOLDERS);
  const renamed: KindWriter = {
    kinds: base.kinds,
    write: base.write,
    readBack: async (kind) =>
      (await base.readBack(kind)).map((r) => (r.projectId === "proj-b" ? { ...r, name: "Other" } : r)),
  };
  const result = await runWebExport({ ...TERMS, source: fakeSource({ paperFields: DEFS }), sink, writers: [renamed] });
  assert.equal(result.state, "incomplete");
  assert.deepEqual(
    result.run.missing.filter((m) => m.kind === "paperFields"),
    [{ kind: "paperFields", id: "proj-b", reason: "project defs differ" }],
  );
});

test("paper fields: a project whose defs are absent on readBack is listed missing by its project id", async () => {
  const sink = new MemorySink();
  const base = createPaperFieldsWriter(sink, FOLDERS);
  const dropB: KindWriter = {
    kinds: base.kinds,
    write: base.write,
    readBack: async (kind) => (await base.readBack(kind)).filter((r) => r.projectId !== "proj-b"),
  };
  const result = await runWebExport({ ...TERMS, source: fakeSource({ paperFields: DEFS }), sink, writers: [dropB] });
  assert.equal(result.state, "incomplete");
  assert.deepEqual(
    result.run.missing.filter((m) => m.kind === "paperFields"),
    [{ kind: "paperFields", id: "proj-b", reason: "project defs absent" }],
  );
});

test("paper fields: with no writer wired, the paper fields are listed missing without the wf-wasm codec reason", async () => {
  const result = await runWebExport({
    ...TERMS,
    source: fakeSource({ paperFields: DEFS }),
    sink: new MemorySink(),
  });
  assert.equal(result.state, "incomplete");
  assert.ok(!result.run.missing.some((m) => m.reason.includes("wf-wasm")));
  assert.ok(result.run.missing.some((m) => m.kind === "paperFields"));
});

test("projectDefsMismatches: an extra project in readBack is listed as differing", () => {
  const extra = [...DEFS, { id: "fz", projectId: "proj-z", name: "Z", kind: "text", options: [], sortOrder: 0 }];
  assert.deepEqual(projectDefsMismatches(DEFS, extra), [{ kind: "paperFields", id: "proj-z", reason: "project defs differ" }]);
  assert.deepEqual(projectDefsMismatches(DEFS, DEFS), []);
});

test("paper field values: written into each paper's frontmatter through FilePaperFieldRepository and verified end to end", async () => {
  const core = typedCore();
  const sink = new MemorySink();
  await sink.write("Thesis/papers/a.paper.md", core.writePaperRow(null, { id: "p1", title: "A" }) + "Body.\n");
  await sink.write("papers/b.paper.md", core.writePaperRow(null, { id: "p2", title: "B" }) + "Body.\n");
  const result = await runWebExport({
    kinds: ["paperFields", "paperFieldValues"],
    codec: NO_CODEC,
    now: NOW,
    source: fakeSource({ paperFields: DEFS, paperFieldValues: VALUES }),
    sink,
    writers: [createPaperFieldsWriter(sink, FOLDERS)],
  });
  assert.deepEqual(result.run.missing, []);
  assert.equal(result.state, "verified");
  const doc = await readSettings(sink);
  const fs = sinkAsWorkspaceFs(sink);
  const { FilePaperRepository } = await import("@/features/papers/infrastructure/file-paper-repository");
  const thesis = new FilePaperFieldRepository(new FilePaperRepository(fs, "Thesis"), settingsOver(doc), fs, () => "Thesis");
  assert.deepEqual(
    (await thesis.listValuesForProject()).map((v) => [v.id, v.value]),
    [
      ["p1:fa", "NeurIPS"],
      ["p1:fa2", 4.5],
    ],
  );
  const root = new FilePaperFieldRepository(new FilePaperRepository(fs, ""), settingsOver(doc), fs, () => "");
  assert.deepEqual((await root.listValuesForProject()).map((v) => [v.id, v.value as FileFieldValue]), [["p2:fb", "ICML"]]);
});

test("paper field values: a value whose paper has no file is listed missing", async () => {
  const sink = new MemorySink();
  const ghost = [...VALUES, { id: "v9", projectId: "proj-a", paperId: "p-ghost", fieldId: "fa", value: "x" }];
  const result = await runWebExport({
    kinds: ["paperFields", "paperFieldValues"],
    codec: NO_CODEC,
    now: NOW,
    source: fakeSource({ paperFields: DEFS, paperFieldValues: ghost }),
    sink,
    writers: [createPaperFieldsWriter(sink, FOLDERS)],
  });
  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.kind === "paperFieldValues" && m.id === "v9"));
});

test("settings writers: paper fields and tags keep each other's keys in either write order", async () => {
  for (const order of ["fields-first", "tags-first"] as const) {
    const sink = new MemorySink();
    const fields = createPaperFieldsWriter(sink, FOLDERS);
    const tags = createTagsWriter(sink);
    const writeFields = async () => {
      for (const def of DEFS) await fields.write("paperFields", def);
    };
    const writeTag = () => tags.write("tags", { id: "Urgent", name: "Urgent", color: "#f00" });
    if (order === "fields-first") {
      await writeFields();
      await writeTag();
    } else {
      await writeTag();
      await writeFields();
    }
    const doc = await readSettings(sink);
    assert.deepEqual(doc.paperFields, defsToSettings(DEFS, FOLDERS), order);
    // The tag's settings key is the slugged name.
    assert.deepEqual(doc.tags, { urgent: { color: "#f00" } }, order);
  }
});

test("paper fields: runWebExport wires the paper-fields writer itself from projectFolders, with no writers passed", async () => {
  const core = typedCore();
  const sink = new MemorySink();
  await sink.write("Thesis/papers/a.paper.md", core.writePaperRow(null, { id: "p1", title: "A" }) + "Body.\n");
  await sink.write("papers/b.paper.md", core.writePaperRow(null, { id: "p2", title: "B" }) + "Body.\n");
  const result = await runWebExport({
    kinds: ["paperFields", "paperFieldValues"],
    codec: NO_CODEC,
    now: NOW,
    source: fakeSource({ paperFields: DEFS, paperFieldValues: VALUES }),
    sink,
    projectFolders: FOLDERS,
  });
  assert.deepEqual(result.run.missing, []);
  assert.equal(result.state, "verified");
  const doc = await readSettings(sink);
  const fs = sinkAsWorkspaceFs(sink);
  const { FilePaperRepository } = await import("@/features/papers/infrastructure/file-paper-repository");
  const thesis = new FilePaperFieldRepository(new FilePaperRepository(fs, "Thesis"), settingsOver(doc), fs, () => "Thesis");
  assert.deepEqual(
    (await thesis.listValuesForProject()).map((v) => [v.id, v.value]),
    [
      ["p1:fa", "NeurIPS"],
      ["p1:fa2", 4.5],
    ],
  );
});

test("paper field values: a null or empty projectId maps to the workspace root", async () => {
  const core = typedCore();
  const sink = new MemorySink();
  await sink.write("papers/b.paper.md", core.writePaperRow(null, { id: "p2", title: "B" }) + "Body.\n");
  const writer = createPaperFieldsWriter(sink, FOLDERS);
  await writer.write("paperFields", DEFS[2] as Row);
  await writer.write("paperFieldValues", { id: "v5", projectId: null, paperId: "p2", fieldId: "fb", value: "ICML" });
  await writer.write("paperFieldValues", { id: "v6", projectId: "", paperId: "p2", fieldId: "fb", value: "ICML" });
  const fs = sinkAsWorkspaceFs(sink);
  const { FilePaperRepository } = await import("@/features/papers/infrastructure/file-paper-repository");
  const root = new FilePaperFieldRepository(new FilePaperRepository(fs, ""), settingsOver(await readSettings(sink)), fs, () => "");
  assert.deepEqual((await root.listValuesForProject()).map((v) => [v.id, v.value as FileFieldValue]), [["p2:fb", "ICML"]]);
});

test("paper field values: an unmapped project is a per-row missing entry and the other rows still export", async () => {
  const core = typedCore();
  const sink = new MemorySink();
  await sink.write("Thesis/papers/a.paper.md", core.writePaperRow(null, { id: "p1", title: "A" }) + "Body.\n");
  const values = [...VALUES.slice(0, 2), { id: "v8", projectId: "proj-unknown", paperId: "p1", fieldId: "fa", value: "x" }];
  const result = await runWebExport({
    kinds: ["paperFields", "paperFieldValues"],
    codec: NO_CODEC,
    now: NOW,
    source: fakeSource({ paperFields: DEFS, paperFieldValues: values }),
    sink,
    writers: [createPaperFieldsWriter(sink, FOLDERS)],
  });
  assert.equal(result.state, "incomplete");
  const missing = result.run.missing.filter((m) => m.kind === "paperFieldValues" && m.id === "v8");
  assert.equal(missing.length, 1);
  assert.ok(!missing[0]?.reason.includes("proj-unknown"));
  const doc = await readSettings(sink);
  const { FilePaperRepository } = await import("@/features/papers/infrastructure/file-paper-repository");
  const fs = sinkAsWorkspaceFs(sink);
  const thesis = new FilePaperFieldRepository(new FilePaperRepository(fs, "Thesis"), settingsOver(doc), fs, () => "Thesis");
  assert.deepEqual((await thesis.listValuesForProject()).map((v) => v.id), ["p1:fa", "p1:fa2"]);
});
