import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "@/lib/rust-core";
import { runWebExport } from "../application/run-web-export";
import type { FileCodec, ServerSource } from "../domain/ports";
import { MemorySink } from "../infrastructure/memory-sink";
import { toCamelRow } from "../infrastructure/postgrest-source";
import { wasmFileCodec } from "../infrastructure/wasm-codec";
import { loadTestCore } from "@/lib/test/load-test-core";

let codec: FileCodec;
before(loadTestCore);
before(async () => {
  const core = await loadCore(readFileSync(new URL("../../../../../../packages/wf-wasm/pkg/wf_wasm_bg.wasm", import.meta.url)));
  codec = wasmFileCodec(core as unknown as Parameters<typeof wasmFileCodec>[0]);
});

const ID = "4a439137-307d-4d1e-b047-16933925fdc8";
// The DB row and the 0.9.5 file of the user's showcase experiment: the file keeps the hypothesis and result as
// `## Hypothesis` / `## Result` body sections and lacks the run command, config and metrics.
const ROW = {
  user_id: "u1", project_id: "p1", server_seq: 1, row_version: 2, deleted_at: null,
  id: ID, name: "exp-01 β-VAE sweep — seed 42", hypothesis: "Higher β improves disentanglement at cost of reconstruction",
  status: "done", repo_url: "https://github.com/example/thesis-code", commit_sha: "a1b2c3d4e5f6", branch: "main",
  run_command: "python train.py --model beta_vae --beta 4 --seed 42", config: { lr: 0.001, beta: 4 }, metrics: { mig: 0.22 },
  artifacts: [], result_note: "Matches Higgins et al. Fig. 6 within 2%. β=4 is the baseline for everything after this.",
  started_at: null, finished_at: null, related_paper: null, created_at: "2026-09-18T12:21:04.555Z", snapshot_upto: null,
};
const legacy = (hypothesis: string, preamble = "") =>
  `---\nweaveforge-id: "${ID}"\nweaveforge-type: experiment\ntitle: "exp-01 β-VAE sweep — seed 42"\nstatus: done\n` +
  `repo-url: "https://github.com/example/thesis-code"\ncommit-sha: a1b2c3d4e5f6\nbranch: main\ncreated-at: "2026-09-18T12:21:04.555Z"\n` +
  `aliases: ["exp-01 β-VAE sweep — seed 42"]\n---\n${preamble}## Hypothesis\n\n${hypothesis}\n\n## Result\n\n${ROW.result_note}\n`;

function server(): ServerSource {
  return {
    listRows: async (k: string) => (k === "experiments" ? [toCamelRow(ROW)] : []),
    countRows: async (k: string) => (k === "experiments" ? 1 : 0),
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async () => [],
    fetchBlob: async () => new Uint8Array(),
    markExported097: async () => {},
    secretProviders: async () => [],
  } as unknown as ServerSource;
}

async function runOver(text: string) {
  const path = codec.toFile("experiments", toCamelRow(ROW)).path;
  const sink = new MemorySink();
  await sink.write(path, text);
  const result = await runWebExport({ kinds: ["experiments"], codec, source: server(), sink, now: "2026-11-26T00:00:00.000Z", runDeviceId: "dev-alpha" });
  const files = (await sink.list()).filter((p) => p.endsWith(".md") && !p.startsWith(".weaveforge/"));
  return { path, sink, result, files };
}

test("a 0.9.5 experiment file with the row's values takes the row in place: no conflict copy, its own keys stay", async () => {
  const { path, sink, result, files } = await runOver(legacy(ROW.hypothesis));

  assert.deepEqual(files, [path], "no conflict copy");
  assert.deepEqual(result.run.missing, []);
  const text = await sink.readText(path);
  assert.match(text, /hypothesis: "Higher β improves/);
  assert.match(text, /run-command: "python train.py/, "the DB's extra values land");
  assert.match(text, /aliases: \["exp-01 β-VAE sweep — seed 42"\]/, "the user's key stays");
});

test("a 0.9.5 experiment file with another hypothesis keeps the file and writes a conflict copy", async () => {
  const text = legacy("My own hypothesis");
  const { path, sink, files } = await runOver(text);

  assert.equal(await sink.readText(path), text, "the user's file is unchanged");
  assert.equal(files.length, 2);
});

test("a 0.9.5 experiment file with text outside its sections keeps the file: that text would be lost", async () => {
  const text = legacy(ROW.hypothesis, "Some notes before the sections.\n\n");
  const { path, sink, files } = await runOver(text);

  assert.equal(await sink.readText(path), text);
  assert.equal(files.length, 2);
});
