/**
 * CompactCrdtLogUseCase: what it asks the store for, and what it does not ask.
 *
 * Compaction used to be two calls from this class — advance the watermark, then
 * delete — and the ordering between them was the whole safety argument. Both are
 * now one call, `ICrdtUpdateStore.compact`, which is a single database
 * transaction with its own rights check. What is left here is the *decision*: a
 * caller with no snapshot does not compact, and a caller whose snapshot is behind
 * the stored watermark does not either.
 *
 * The class's own test should therefore be about which calls it makes and what it
 * does with the answer — the ordering and the rights check are the store's, and
 * are tested against a real Postgres in the integration suite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { CompactCrdtLogUseCase } from "../../../src/features/collab/application/compact-crdt-log.use-case.js";
import type {
  CompactOutcome,
  ICrdtUpdateStore,
} from "../../../src/features/collab/domain/crdt-update-store.js";

/** Records what the use case asked for, and answers however a test says. */
class RecordingStore implements ICrdtUpdateStore {
  readonly compactions: { resourceType: string; resourceId: string; uptoId: number; currentUpto?: number }[] = [];
  answer: CompactOutcome = { status: "compacted", deleted: 7 };

  async append(): Promise<never> {
    throw new Error("append is not part of compaction");
  }
  async listAfter(): Promise<never[]> {
    return [];
  }
  async deleteUpTo(): Promise<void> {
    throw new Error("compaction must not sweep outside `compact`");
  }
  async deleteAll(): Promise<void> {
    throw new Error("compaction must not sweep outside `compact`");
  }
  async countAfter(): Promise<number> {
    return 0;
  }
  async compact(input: { resourceType: string; resourceId: string; uptoId: number; currentUpto?: number }) {
    this.compactions.push(input);
    return this.answer;
  }
}

const RESOURCE = { resourceType: "vault_page", resourceId: "page-1" };

test("compaction asks the store for one transactional call", async () => {
  const store = new RecordingStore();
  const useCase = new CompactCrdtLogUseCase({ crdtStore: store });

  const outcome = await useCase.execute({ ...RESOURCE, snapshotUptoId: 100 });

  assert.deepEqual(store.compactions, [{ ...RESOURCE, uptoId: 100, currentUpto: undefined }]);
  assert.deepEqual(outcome, { status: "compacted", deleted: 7 }, "and answers with what the database said");
});

test("a caller with no snapshot does not touch the database", async () => {
  const store = new RecordingStore();
  const useCase = new CompactCrdtLogUseCase({ crdtStore: store });

  const outcome = await useCase.execute({ ...RESOURCE, snapshotUptoId: 0 });

  assert.deepEqual(store.compactions, []);
  assert.deepEqual(outcome, { status: "no-op", reason: "nothing-to-do" });
});

test("a stale caller is a no-op rather than a round trip", async () => {
  // Two writers co-editing means two clients can compact. One holding an older
  // snapshot must not rewind the watermark: the loader replays from it, so an id
  // behind the stored one asks for a range whose rows are already gone. The
  // database refuses that too — this is the cheap local answer, not the guard.
  const store = new RecordingStore();
  const useCase = new CompactCrdtLogUseCase({ crdtStore: store });

  const outcome = await useCase.execute({ ...RESOURCE, snapshotUptoId: 100, currentSnapshotUpto: 200 });

  assert.deepEqual(store.compactions, []);
  assert.deepEqual(outcome, { status: "no-op", reason: "stale" });
});

test("a caller that is the newest one is asked of the database", async () => {
  const store = new RecordingStore();
  const useCase = new CompactCrdtLogUseCase({ crdtStore: store });

  await useCase.execute({ ...RESOURCE, snapshotUptoId: 200, currentSnapshotUpto: 100 });

  assert.deepEqual(store.compactions, [{ ...RESOURCE, uptoId: 200, currentUpto: 100 }]);
});

test("a refusal is passed through, not swallowed or thrown", async () => {
  // The interesting answer. A reader who may view a document but not edit it gets
  // `not-permitted` from the database, and the caller needs to know so it can say
  // so once instead of retrying forever.
  const store = new RecordingStore();
  store.answer = { status: "not-permitted" };
  const useCase = new CompactCrdtLogUseCase({ crdtStore: store });

  const outcome = await useCase.execute({ ...RESOURCE, snapshotUptoId: 100 });

  assert.deepEqual(outcome, { status: "not-permitted" });
});
