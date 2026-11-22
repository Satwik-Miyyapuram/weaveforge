import { test } from "node:test";
import assert from "node:assert/strict";
import { MemorySettings } from "./memory-settings";
import { FileCitationAlertTrackRepository } from "../file-citation-alert-track-repo";

function setup() {
  const settings = new MemorySettings();
  return { settings, repo: new FileCitationAlertTrackRepository(settings) };
}

test("track creates a watch with an id and trackedAt; getByPaperId returns it", async () => {
  const { repo } = setup();
  const track = await repo.track({ paperId: "p-1" });
  assert.equal(track.paperId, "p-1");
  assert.ok(track.id.length > 0);
  assert.ok(!Number.isNaN(Date.parse(track.trackedAt)));
  assert.deepEqual(track.seenCitingIds, []);
  assert.deepEqual(await repo.getByPaperId("p-1"), track);
  assert.equal(await repo.getByPaperId("missing"), null);
});

test("track again keeps the id and trackedAt and takes the new seen ids", async () => {
  const { repo } = setup();
  const first = await repo.track({ paperId: "p-1" });
  const again = await repo.track({ paperId: "p-1", seenCitingIds: ["c-1"], lastCheckedAt: "2026-02-01T00:00:00.000Z" });
  assert.equal(again.id, first.id);
  assert.equal(again.trackedAt, first.trackedAt);
  assert.deepEqual(again.seenCitingIds, ["c-1"]);
  assert.equal(again.lastCheckedAt, "2026-02-01T00:00:00.000Z");
});

test("save replaces the stored watch; listForProject lists every watch", async () => {
  const { repo } = setup();
  const a = await repo.track({ paperId: "p-1" });
  await repo.track({ paperId: "p-2" });
  await repo.save({ ...a, seenCitingIds: ["c-9"] });
  const listed = await repo.listForProject();
  assert.deepEqual(listed.map((t) => t.paperId).sort(), ["p-1", "p-2"]);
  assert.deepEqual((await repo.getByPaperId("p-1"))?.seenCitingIds, ["c-9"]);
});

test("untrack removes one watch and leaves the others", async () => {
  const { repo } = setup();
  await repo.track({ paperId: "p-1" });
  await repo.track({ paperId: "p-2" });
  await repo.untrack("p-1");
  assert.equal(await repo.getByPaperId("p-1"), null);
  assert.deepEqual((await repo.listForProject()).map((t) => t.paperId), ["p-2"]);
  await repo.untrack("p-1");
});

test("a returned watch is a copy: changing it does not change the stored one", async () => {
  const { repo } = setup();
  const track = await repo.track({ paperId: "p-1", seenCitingIds: ["c-1"] });
  track.seenCitingIds.push("c-2");
  assert.deepEqual((await repo.getByPaperId("p-1"))?.seenCitingIds, ["c-1"]);
});

test("watches are stored under citationAlerts in the settings file", async () => {
  const { repo, settings } = setup();
  await repo.track({ paperId: "p-1" });
  assert.ok(settings.get(["citationAlerts", "p-1"]));
});

test("a malformed stored entry is skipped and reported, never thrown", async () => {
  const { settings, repo } = setup();
  await repo.track({ paperId: "p-good" });
  settings.set(["citationAlerts", "p-bad-time"], { id: "x", trackedAt: 5, seenCitingIds: [] });
  settings.set(["citationAlerts", "p-bad-list"], { id: "y", trackedAt: "2026-01-01T00:00:00.000Z", seenCitingIds: "c-1" });
  settings.set(["citationAlerts", "p-bad-item"], {
    id: "z",
    trackedAt: "2026-01-01T00:00:00.000Z",
    seenCitingIds: ["c-1", 3],
  });
  assert.deepEqual((await repo.listForProject()).map((t) => t.paperId), ["p-good"]);
  assert.equal(await repo.getByPaperId("p-bad-list"), null);
  assert.deepEqual((await repo.failures()).map((f) => f.paperId).sort(), ["p-bad-item", "p-bad-list", "p-bad-time"]);
  assert.deepEqual((await repo.failures()).length, 3);
});

test("track never overwrites a malformed stored entry; it stays in settings and in failures()", async () => {
  const { settings, repo } = setup();
  const bad = { id: "x", trackedAt: "2026-01-01T00:00:00.000Z", seenCitingIds: ["c-1", 3] };
  settings.set(["citationAlerts", "p-bad"], bad);
  await assert.rejects(repo.track({ paperId: "p-bad" }));
  assert.deepEqual(settings.get(["citationAlerts", "p-bad"]), bad);
  assert.deepEqual((await repo.failures()).map((f) => f.paperId), ["p-bad"]);
});
