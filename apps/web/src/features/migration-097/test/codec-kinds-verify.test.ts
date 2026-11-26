import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "@/lib/rust-core";
import { sameRows } from "../application/verify-export";
import { toCamelRow } from "../infrastructure/postgrest-source";
import { wasmFileCodec } from "../infrastructure/wasm-codec";

let core: Awaited<ReturnType<typeof loadCore>>;
before(async () => {
  core = await loadCore(readFileSync(new URL("../../../../../../packages/wf-wasm/pkg/wf_wasm_bg.wasm", import.meta.url)));
});

const AT = "2026-09-18T12:21:04.551Z";
const SYNC = { user_id: "u1", project_id: "p1", server_seq: 6037, row_version: 2, deleted_at: null };

/** Rows with every column the old local database holds, sync counters and nulls included. */
const ROWS: Record<string, Record<string, unknown>> = {
  logEntries: { ...SYNC, id: "l1", entry_date: "2026-09-12", kind: "note", body: "Did it.", links: [], created_at: AT, snapshot_upto: null },
  experiments: {
    ...SYNC, id: "e1", name: "Run", hypothesis: null, status: "done", repo_url: null, commit_sha: null, branch: null,
    run_command: null, config: { seed: 1 }, metrics: { mig: 0.14 }, artifacts: [], result_note: null,
    started_at: null, finished_at: null, related_paper: null, created_at: AT,
  },
  reportSections: {
    ...SYNC, id: "s1", title: "Intro", section_no: "1", parent_id: null, status: "not_started", word_count: 0,
    target_words: null, deadline: null, draft_url: null, notes: null, sort_order: 0, created_at: AT, snapshot_upto: 7, updated_at: AT,
  },
  readingLists: {
    ...SYNC, id: "r1", name: "Core", description: null, parent_id: null, sort_order: 1, color: "#336699", created_at: AT,
  },
};

for (const kind of Object.keys(ROWS)) {
  test(`${kind}: a full database row matches its file`, () => {
    const codec = wasmFileCodec(core as unknown as Parameters<typeof wasmFileCodec>[0]);
    const row = toCamelRow(ROWS[kind]!);
    const file = codec.toFile(kind, row);
    const back = codec.toRow(kind, file.path, file.text)!;
    assert.ok(sameRows(kind, [row], [back]));
    // A real content change is still caught.
    const field = { logEntries: "body", experiments: "name", reportSections: "title", readingLists: "name" }[kind]!;
    assert.ok(!sameRows(kind, [{ ...row, [field]: "changed" }], [back]));
    // So is a value the file lost.
    const lost = { ...back };
    delete lost[field];
    assert.ok(!sameRows(kind, [row], [lost]));
  });
}

test("reportSections: notes ending in a newline match an old app file that holds them without the codec's extra newline", () => {
  const codec = wasmFileCodec(core as unknown as Parameters<typeof wasmFileCodec>[0]);
  const row = toCamelRow({ ...ROWS.reportSections!, notes: "[[A paper]] \n" });
  const file = codec.toFile("reportSections", row);
  assert.ok(file.text.endsWith("[[A paper]] \n\n"));
  const back = codec.toRow("reportSections", file.path, file.text.slice(0, -1))!;
  assert.ok(sameRows("reportSections", [row], [back]));
  const edited = codec.toRow("reportSections", file.path, file.text.replace("[[A paper]]", "[[B paper]]"))!;
  assert.ok(!sameRows("reportSections", [row], [edited]), "a real edit still differs");
});
