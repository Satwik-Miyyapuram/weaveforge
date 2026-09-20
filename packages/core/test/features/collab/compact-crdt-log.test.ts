/**
 * CompactCrdtLogUseCase: which of the two steps may happen first.
 *
 * Compaction ends with two writes: bake the tail into a snapshot and move the
 * watermark past it, then drop the update rows the snapshot now covers. The
 * order is the whole safety argument. Destroying the rows first means every
 * crash, refused request or dropped connection in between leaves a log that has
 * lost the newest edits while the watermark still claims they are reachable —
 * and the only durable copy is the document body, which collaborative editing
 * writes fire-and-forget (review of the collab path, finding B01/B08). The
 * watermark has to move first; deleting afterwards is idempotent cleanup.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { CompactCrdtLogUseCase } from "../../../src/features/collab/application/compact-crdt-log.use-case.js";
import type { ICrdtUpdateStore } from "../../../src/features/collab/domain/crdt-update-store.js";

/** Records the order of the two steps, and can refuse the first of them. */
class RecordingStore implements ICrdtUpdateStore {
  readonly calls: string[] = [];
  readonly deletedUpTo: number[] = [];
  refuseWatermark: Error | null = null;

  async append(): Promise<never> {
    throw new Error("append is not part of compaction");
  }
  async listAfter(): Promise<never[]> {
    return [];
  }
  async deleteUpTo(_resourceType: string, _resourceId: string, uptoId: number): Promise<void> {
    this.calls.push("delete");
    this.deletedUpTo.push(uptoId);
  }
  async deleteAll(): Promise<void> {
    this.calls.push("deleteAll");
  }
  async countAfter(): Promise<number> {
    return 0;
  }
}

const RESOURCE = { resourceType: "vault_page", resourceId: "page-1" };

test("compaction advances the watermark before it destroys the update log", async () => {
  const store = new RecordingStore();
  const useCase = new CompactCrdtLogUseCase({ crdtStore: store });

  await useCase.execute({
    ...RESOURCE,
    snapshotUptoId: 100,
    setSnapshotUpto: async () => {
      store.calls.push("watermark");
    },
  });

  assert.deepEqual(
    store.calls,
    ["watermark", "delete"],
    "the destructive step must not be able to happen before the bookkeeping step",
  );
  assert.deepEqual(store.deletedUpTo, [100]);
});

test("compaction leaves the log alone when the watermark cannot be recorded", async () => {
  const store = new RecordingStore();
  store.refuseWatermark = new Error("network");
  const useCase = new CompactCrdtLogUseCase({ crdtStore: store });

  await assert.rejects(
    useCase.execute({
      ...RESOURCE,
      snapshotUptoId: 100,
      setSnapshotUpto: async () => {
        store.calls.push("watermark");
        throw store.refuseWatermark!;
      },
    }),
    /network/,
  );

  assert.deepEqual(
    store.deletedUpTo,
    [],
    "a watermark that was never stored must not have cost us the updates it was to cover",
  );
});

test("compaction with nothing to cover is a no-op", async () => {
  const store = new RecordingStore();
  const useCase = new CompactCrdtLogUseCase({ crdtStore: store });

  await useCase.execute({
    ...RESOURCE,
    snapshotUptoId: 0,
    setSnapshotUpto: async () => {
      store.calls.push("watermark");
    },
  });

  assert.deepEqual(store.calls, []);
});

test("a stale caller cannot move the watermark backwards", async () => {
  // Two writers co-editing means two clients can compact. One holding an
  // older snapshot must be a no-op, not a rewind: the loader replays from the
  // watermark, so an id behind the stored one asks it to replay a range whose
  // rows have already been compacted away.
  const store = new RecordingStore();
  const useCase = new CompactCrdtLogUseCase({ crdtStore: store });

  await useCase.execute({
    ...RESOURCE,
    snapshotUptoId: 100,
    currentSnapshotUpto: 200,
    setSnapshotUpto: async () => {
      store.calls.push("watermark");
    },
  });

  assert.deepEqual(store.calls, [], "an older watermark must not be written, nor its rows deleted");
});

test("compaction still runs when the caller is the newest one", async () => {
  const store = new RecordingStore();
  const useCase = new CompactCrdtLogUseCase({ crdtStore: store });

  await useCase.execute({
    ...RESOURCE,
    snapshotUptoId: 200,
    currentSnapshotUpto: 100,
    setSnapshotUpto: async () => {
      store.calls.push("watermark");
    },
  });

  assert.deepEqual(store.calls, ["watermark", "delete"]);
});
