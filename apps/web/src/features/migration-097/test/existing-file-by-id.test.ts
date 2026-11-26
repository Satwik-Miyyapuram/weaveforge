import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "@/lib/rust-core";
import { dirOf } from "../application/verify-export";
import { runWebExport } from "../application/run-web-export";
import type { FileCodec, ServerSource } from "../domain/ports";
import { MemorySink } from "../infrastructure/memory-sink";
import { toCamelRow } from "../infrastructure/postgrest-source";
import { wasmFileCodec } from "../infrastructure/wasm-codec";

let codec: FileCodec;
before(async () => {
  const core = await loadCore(readFileSync(new URL("../../../../../../packages/wf-wasm/pkg/wf_wasm_bg.wasm", import.meta.url)));
  codec = wasmFileCodec(core as unknown as Parameters<typeof wasmFileCodec>[0]);
});

const SYNC = { user_id: "u1", project_id: "p1", server_seq: 6037, row_version: 2, deleted_at: null };
const LIST_ID = "51f8bf19-bcd3-4173-977e-a64756667224";
const SECTION_ID = "21774a74-faac-4d6a-8fbb-b33faf4f61cc";

// Rows and files as the user's thesis workspace holds them: the files predate the run, carry the row's id,
// and lack the keys the DB adds (order, wf, word-count, updated-at).
const CASES = [
  {
    kind: "readingLists",
    name: "ssl.list.md",
    row: { ...SYNC, id: LIST_ID, name: "SSL", description: null, parent_id: null, sort_order: 0, color: "#5a7d8c", created_at: "2026-10-07T10:58:50.185Z" },
    text: `---\nweaveforge-id: "${LIST_ID}"\nweaveforge-type: reading_list\ntitle: SSL\ncolor: "#5a7d8c"\ncreated-at: "2026-10-07T10:58:50.185Z"\naliases: [SSL]\n---\n`,
  },
  {
    kind: "reportSections",
    name: "introduction.report.md",
    row: {
      ...SYNC, id: SECTION_ID, title: "Introduction", section_no: "1", parent_id: null, status: "not_started", word_count: 0,
      target_words: null, deadline: null, draft_url: null, notes: null, sort_order: 0,
      created_at: "2026-10-28T00:26:20.947Z", updated_at: "2026-10-28T00:26:20.948Z", snapshot_upto: null,
    },
    text: `---\nweaveforge-id: "${SECTION_ID}"\nweaveforge-type: report_section\ntitle: Introduction\nsection-no: "1"\nstatus: not_started\ncreated-at: "2026-10-28T00:26:20.947Z"\naliases: [Introduction]\n---\n`,
  },
] as const;

function server(kind: string, row: Record<string, unknown>): ServerSource {
  return {
    listRows: async (k: string) => (k === kind ? [row] : []),
    countRows: async (k: string) => (k === kind ? 1 : 0),
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async () => [],
    fetchBlob: async () => new Uint8Array(),
    markExported097: async () => {},
    secretProviders: async () => [],
  } as unknown as ServerSource;
}

for (const c of CASES) {
  test(`${c.kind}: an existing file with the row's id takes the row; no second file, and verify passes`, async () => {
    const row = toCamelRow(c.row);
    const dir = dirOf(codec.toFile(c.kind, row).path);
    const existing = dir ? `${dir}/${c.name}` : c.name;
    const sink = new MemorySink();
    await sink.write(existing, c.text);

    const result = await runWebExport({ kinds: [c.kind], codec, source: server(c.kind, row), sink, now: "2026-11-26T00:00:00.000Z", runDeviceId: "dev-alpha" });

    assert.deepEqual(result.run.missing, []);
    const rowFiles = (await sink.list()).filter((p) => !p.startsWith(".weaveforge/") && dirOf(p) === dir);
    assert.deepEqual(rowFiles, [existing], "the user's file is the row's only file");
    const text = await sink.readText(existing);
    assert.match(text, /aliases: \[/, "the user's own keys stay");
    assert.match(text, /order: 0/, "the DB's order lands in the user's file");
  });
}
