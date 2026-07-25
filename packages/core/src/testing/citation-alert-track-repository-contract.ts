import { test } from "node:test";
import assert from "node:assert/strict";
import type { ICitationAlertTrackRepository } from "../features/relations/domain/citation-alert-track-repository.js";

export function runCitationAlertTrackRepositoryContract(
  label: string,
  factory: () => ICitationAlertTrackRepository,
): void {
  test(`[${label}] track then getByPaperId round-trips`, async () => {
    const repo = factory();
    const track = await repo.track({
      paperId: "paper-1",
      seenCitingIds: ["s2-a"],
      lastCheckedAt: "2026-07-01T00:00:00.000Z",
    });
    assert.equal(track.paperId, "paper-1");
    assert.deepEqual((await repo.getByPaperId("paper-1"))?.seenCitingIds, ["s2-a"]);
  });

  test(`[${label}] track is idempotent on paperId`, async () => {
    const repo = factory();
    const first = await repo.track({ paperId: "paper-1", seenCitingIds: ["a"] });
    const second = await repo.track({ paperId: "paper-1", seenCitingIds: ["a", "b"] });
    assert.equal(first.id, second.id);
    assert.deepEqual(second.seenCitingIds, ["a", "b"]);
    assert.equal((await repo.listForProject()).length, 1);
  });

  test(`[${label}] untrack removes the row`, async () => {
    const repo = factory();
    await repo.track({ paperId: "paper-1" });
    await repo.untrack("paper-1");
    assert.equal(await repo.getByPaperId("paper-1"), null);
  });

  test(`[${label}] save updates lastCheckedAt and seen ids`, async () => {
    const repo = factory();
    const track = await repo.track({ paperId: "paper-1", seenCitingIds: [] });
    await repo.save({
      ...track,
      lastCheckedAt: "2026-07-02T00:00:00.000Z",
      seenCitingIds: ["new"],
    });
    const saved = await repo.getByPaperId("paper-1");
    assert.equal(saved?.lastCheckedAt, "2026-07-02T00:00:00.000Z");
    assert.deepEqual(saved?.seenCitingIds, ["new"]);
  });
}
