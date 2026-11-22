import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { AiWriteProposal } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileAiProposalStore } from "../file-ai-proposal-store";

before(loadTestCore);

function proposal(over: Partial<AiWriteProposal> = {}): AiWriteProposal {
  return {
    id: crypto.randomUUID(),
    kind: "append_paper_note",
    resourceId: "paper-1",
    content: "Adds a note on the ablation.",
    createdAt: "2026-06-24T00:00:00.000Z",
    status: "pending",
    sourceLinks: [],
    ...over,
  };
}

function setup() {
  const fs = new MemoryWorkspaceFs();
  return { fs, store: new FileAiProposalStore(fs) };
}

test("save then getById returns the proposal unchanged; absent id is null", async () => {
  const { store } = setup();
  const p = proposal({ sourceLinks: ["a", "b"], expectedRevision: "r1" });
  await store.save(p);
  assert.deepEqual(await store.getById(p.id), p);
  assert.equal(await store.getById("nope"), null);
});

test("listPending returns only pending proposals, newest first", async () => {
  const { store } = setup();
  const old = proposal({ createdAt: "2026-06-01T00:00:00.000Z" });
  const newer = proposal({ createdAt: "2026-06-20T00:00:00.000Z" });
  const done = proposal({ status: "accepted" });
  for (const p of [old, newer, done]) await store.save(p);
  assert.deepEqual((await store.listPending()).map((p) => p.id), [newer.id, old.id]);
});

test("claimPending is true once, then false", async () => {
  const { store } = setup();
  const p = proposal();
  await store.save(p);
  assert.equal(await store.claimPending(p.id), true);
  assert.equal((await store.getById(p.id))?.status, "executing");
  assert.equal(await store.claimPending(p.id), false);
  assert.equal(await store.claimPending("nope"), false);
});

test("a corrupt .json file is skipped by listPending and reads as null", async () => {
  const { fs, store } = setup();
  const p = proposal();
  await store.save(p);
  await fs.writeFile(".weaveforge/proposals/broken.json", "{ not json");
  assert.deepEqual((await store.listPending()).map((x) => x.id), [p.id]);
  assert.equal(await store.getById("broken"), null);
});

test("a secret-looking field is refused on save and nothing is written", async () => {
  const { fs, store } = setup();
  const p = proposal({ payload: { provider: { apiKey: "sk-secret-value" } } });
  await assert.rejects(store.save(p), /apiKey/);
  assert.equal(await store.getById(p.id), null);
  assert.equal(await fs.stat(`.weaveforge/proposals/${p.id}.json`), null);
});

test("keys that only contain 'key' mid-word are not refused; real key names are", async () => {
  const { store } = setup();
  const ok = proposal({ payload: { primaryKey: "row-1", monkey: "banana" } });
  await store.save(ok);
  assert.deepEqual(await store.getById(ok.id), ok);
  const bad = proposal({ payload: { apiKey: "x" } });
  await assert.rejects(store.save(bad), /apiKey/);
});
