import { test } from "node:test";
import assert from "node:assert/strict";
import { AddLogEntryUseCase } from "../../../src/features/logbook/application/add-log-entry.use-case.js";
import { CheckCitationAlertsUseCase } from "../../../src/features/relations/application/check-citation-alerts.use-case.js";
import type {
  CitationCandidate,
  ICitationSource,
} from "../../../src/features/relations/application/citation-source.js";
import type { INotificationIntegration } from "../../../src/features/integrations/domain/integration-ports.js";
import type { PaperRef } from "../../../src/features/papers/application/metadata-source.js";
import type { Milestone } from "../../../src/features/plan/domain/milestone.js";
import type { Paper } from "../../../src/features/papers/domain/paper.js";
import { InMemoryCitationAlertTrackRepository } from "../../../src/testing/in-memory-citation-alert-track-repository.js";
import { InMemoryLogEntryRepository } from "../../../src/testing/in-memory-log-entry-repository.js";
import { InMemoryPaperRepository } from "../../../src/testing/in-memory-paper-repository.js";

const paper: Paper = {
  id: "paper-1",
  title: "Tracked work",
  authors: ["A. Author"],
  doi: "10.1000/tracked",
  status: "read",
  tags: [],
  metadata: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const paper2: Paper = {
  ...paper,
  id: "paper-2",
  title: "Second tracked",
  doi: "10.1000/tracked-2",
};

class Source implements ICitationSource {
  readonly id = "test";
  itemsByDoi = new Map<string, CitationCandidate[]>();
  failFor = new Set<string>();
  gate: Promise<void> | null = null;
  supports(_ref: PaperRef) {
    return true;
  }
  async references(_ref: PaperRef) {
    return [];
  }
  async citations(ref: PaperRef) {
    if (this.gate) await this.gate;
    if (this.failFor.has(ref.value)) throw new Error(`citations failed for ${ref.value}`);
    return this.itemsByDoi.get(ref.value) ?? [];
  }
}

class Notifications implements INotificationIntegration {
  readonly providerId = "test";
  alerts: CitationCandidate[][] = [];
  async notifyMilestone(_event: "added" | "status", _milestone: Milestone) {}
  async notifyCitationAlert(_tracked: Paper, citing: CitationCandidate[]) {
    this.alerts.push(citing);
  }
}

class FailingLogs extends AddLogEntryUseCase {
  override async add(): Promise<never> {
    throw new Error("log write failed");
  }
}

function setup(opts?: { getProjectId?: () => string | null; failingLogs?: boolean }) {
  const papers = new InMemoryPaperRepository();
  const tracks = new InMemoryCitationAlertTrackRepository();
  const logs = new InMemoryLogEntryRepository();
  const source = new Source();
  const notifications = new Notifications();
  let now = "2026-07-01T12:00:00.000Z";
  let id = 0;
  const clock = { nowIso: () => now };
  const logUseCase = opts?.failingLogs
    ? new FailingLogs({
        repository: logs,
        clock,
        ids: { newId: () => `log-${++id}` },
      })
    : new AddLogEntryUseCase({
        repository: logs,
        clock,
        ids: { newId: () => `log-${++id}` },
      });
  const useCase = new CheckCitationAlertsUseCase({
    papers,
    tracks,
    sources: [source],
    logs: logUseCase,
    notifications,
    clock,
    getProjectId: opts?.getProjectId,
  });
  return {
    papers,
    tracks,
    logs,
    source,
    notifications,
    useCase,
    setNow: (iso: string) => {
      now = iso;
    },
  };
}

test("baselines existing citations then logs and notifies only new ones", async () => {
  const { papers, tracks, logs, source, notifications, useCase, setNow } = setup();
  await papers.save(paper);

  source.itemsByDoi.set(paper.doi!, [{ id: "old", title: "Existing citation", authors: [] }]);
  await useCase.setTracking(paper.id, true);
  assert.equal(await useCase.isTracking(paper.id), true);
  assert.equal((await logs.list()).length, 0);
  assert.deepEqual((await tracks.getByPaperId(paper.id))?.seenCitingIds, ["old"]);

  setNow("2026-07-02T13:00:00.000Z");
  source.itemsByDoi.set(paper.doi!, [
    { id: "old", title: "Existing citation", authors: [] },
    { id: "new", title: "New citation", authors: ["N. Author"], year: 2026 },
  ]);
  const result = await useCase.checkAll();

  assert.deepEqual(result, { tracked: 1, checked: 1, found: 1 });
  assert.match((await logs.list())[0]!.body, /New citation/);
  assert.deepEqual(notifications.alerts.map((items) => items.map((item) => item.id)), [["new"]]);

  assert.deepEqual(await useCase.checkAll(), { tracked: 1, checked: 0, found: 0 });
  assert.equal((await logs.list()).length, 1);
});

test("does not mark citations seen when log write fails", async () => {
  const { papers, tracks, source, useCase, setNow } = setup({ failingLogs: true });
  await papers.save(paper);
  source.itemsByDoi.set(paper.doi!, [{ id: "old", title: "Existing", authors: [] }]);
  await useCase.setTracking(paper.id, true);

  setNow("2026-07-02T13:00:00.000Z");
  source.itemsByDoi.set(paper.doi!, [
    { id: "old", title: "Existing", authors: [] },
    { id: "new", title: "New", authors: [] },
  ]);
  await useCase.checkAll();

  assert.deepEqual((await tracks.getByPaperId(paper.id))?.seenCitingIds, ["old"]);
});

test("unions seen ids when a later fetch is a partial subset", async () => {
  const { papers, tracks, source, useCase, setNow } = setup();
  await papers.save(paper);
  source.itemsByDoi.set(paper.doi!, [
    { id: "a", title: "A", authors: [] },
    { id: "b", title: "B", authors: [] },
  ]);
  await useCase.setTracking(paper.id, true);

  setNow("2026-07-02T13:00:00.000Z");
  // Truncated page missing "a" must not forget it.
  source.itemsByDoi.set(paper.doi!, [{ id: "b", title: "B", authors: [] }]);
  await useCase.checkAll(true);

  assert.deepEqual(
    new Set((await tracks.getByPaperId(paper.id))?.seenCitingIds),
    new Set(["a", "b"]),
  );
});

test("untrack during an in-flight check is not overwritten", async () => {
  const { papers, tracks, source, useCase, setNow } = setup();
  await papers.save(paper);
  source.itemsByDoi.set(paper.doi!, [{ id: "old", title: "Existing", authors: [] }]);
  await useCase.setTracking(paper.id, true);

  setNow("2026-07-02T13:00:00.000Z");
  let release!: () => void;
  source.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  source.itemsByDoi.set(paper.doi!, [
    { id: "old", title: "Existing", authors: [] },
    { id: "new", title: "New", authors: [] },
  ]);

  const pending = useCase.checkAll(true);
  await useCase.setTracking(paper.id, false);
  release();
  await pending;

  assert.equal(await tracks.getByPaperId(paper.id), null);
});

test("one paper failing citations does not skip the rest", async () => {
  const { papers, tracks, logs, source, useCase, setNow } = setup();
  await papers.save(paper);
  await papers.save(paper2);
  source.itemsByDoi.set(paper.doi!, [{ id: "p1-old", title: "Old1", authors: [] }]);
  source.itemsByDoi.set(paper2.doi!, [{ id: "p2-old", title: "Old2", authors: [] }]);
  await useCase.setTracking(paper.id, true);
  await useCase.setTracking(paper2.id, true);

  setNow("2026-07-02T13:00:00.000Z");
  source.failFor.add(paper.doi!);
  source.itemsByDoi.set(paper2.doi!, [
    { id: "p2-old", title: "Old2", authors: [] },
    { id: "p2-new", title: "New2", authors: [] },
  ]);
  const result = await useCase.checkAll(true);

  assert.equal(result.checked, 1);
  assert.equal(result.found, 1);
  assert.match((await logs.list())[0]!.body, /New2/);
  assert.ok(await tracks.getByPaperId(paper.id));
});

test("forced check waits for in-flight poll then runs with force", async () => {
  const { papers, source, useCase, setNow } = setup();
  await papers.save(paper);
  source.itemsByDoi.set(paper.doi!, [{ id: "old", title: "Existing", authors: [] }]);
  await useCase.setTracking(paper.id, true);

  setNow("2026-07-01T12:30:00.000Z"); // same day — non-force would skip
  let release!: () => void;
  source.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // First call is force so it actually enters citations and holds the gate.
  const first = useCase.checkAll(true);
  const second = useCase.checkAll(true);
  source.itemsByDoi.set(paper.doi!, [
    { id: "old", title: "Existing", authors: [] },
    { id: "new", title: "New", authors: [] },
  ]);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.found + b.found, 1);
});

test("aborts further writes when project id changes mid-check", async () => {
  let projectId: string | null = "proj-a";
  const { papers, tracks, logs, source, useCase, setNow } = setup({
    getProjectId: () => projectId,
  });
  await papers.save(paper);
  await papers.save(paper2);
  source.itemsByDoi.set(paper.doi!, [{ id: "p1-old", title: "Old1", authors: [] }]);
  source.itemsByDoi.set(paper2.doi!, [{ id: "p2-old", title: "Old2", authors: [] }]);
  await useCase.setTracking(paper.id, true);
  await useCase.setTracking(paper2.id, true);

  setNow("2026-07-02T13:00:00.000Z");
  let release!: () => void;
  let entered!: () => void;
  const enteredCitations = new Promise<void>((resolve) => {
    entered = resolve;
  });
  source.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalCitations = source.citations.bind(source);
  source.citations = async (ref: PaperRef) => {
    entered();
    return originalCitations(ref);
  };
  source.itemsByDoi.set(paper.doi!, [
    { id: "p1-old", title: "Old1", authors: [] },
    { id: "p1-new", title: "New1", authors: [] },
  ]);
  source.itemsByDoi.set(paper2.doi!, [
    { id: "p2-old", title: "Old2", authors: [] },
    { id: "p2-new", title: "New2", authors: [] },
  ]);

  const pending = useCase.checkAll(true);
  await enteredCitations;
  projectId = "proj-b";
  release();
  const result = await pending;

  assert.equal((await logs.list()).length, 0);
  assert.deepEqual((await tracks.getByPaperId(paper.id))?.seenCitingIds, ["p1-old"]);
  assert.equal(result.found, 0);
});
