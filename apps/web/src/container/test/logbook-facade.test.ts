import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundError } from "@weaveforge/core";
import type { AddLogEntryUseCase, ILogEntryRepository, LogEntry } from "@weaveforge/core";
import { LogbookFacade } from "../facades/logbook";

/**
 * The one rule the editor pane needs from the logbook.
 *
 * `AddLogEntryUseCase.update` takes a kind as well as a body, because the
 * logbook screen renders a Kind select beside the text. The workspace pane
 * edits the *markdown*, which has no opinion about the kind — so if a save from
 * there passed only a body the use case would either refuse it or, worse, write
 * a default. A log entry that silently changed from `weekly` to `daily` because
 * somebody fixed a typo in the editor is the bug this pins.
 */

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: "e1",
    entryDate: "2026-03-14",
    kind: "weekly",
    body: "Ran the ablation.",
    links: [],
    createdAt: "2026-03-14T09:00:00.000Z",
    ...overrides,
  } as LogEntry;
}

function facade(existing: LogEntry | null, options: { notFound?: boolean } = {}) {
  const written: { id: string; body: string; kind: string }[] = [];
  const repository = {
    getById: async () => existing,
    list: async () => (existing ? [existing] : []),
    save: async () => {},
    delete: async () => {},
  } as unknown as ILogEntryRepository;
  const addLogEntry = {
    update: async (id: string, input: { body: string; kind: string }) => {
      // The real use case's own rule, so the stub cannot pass a test the
      // production path would fail.
      if (options.notFound) throw new NotFoundError(`No log entry with id "${id}".`);
      written.push({ id, body: input.body, kind: input.kind });
      return { ...(existing ?? entry()), ...input, id } as LogEntry;
    },
  } as unknown as AddLogEntryUseCase;
  const logbook = new LogbookFacade({
    logEntries: repository,
    addLogEntry,
    logSync: { pushLog: async () => {}, removeLog: async () => {} },
  } as never);
  return { logbook, written };
}

test("saving a body from the editor keeps the entry's own kind", async () => {
  const { logbook, written } = facade(entry({ kind: "weekly" }));
  await logbook.saveEntryBody("e1", "Ran the ablation, again.");
  assert.deepEqual(written, [{ id: "e1", body: "Ran the ablation, again.", kind: "weekly" }]);
});

test("a daily entry stays daily", async () => {
  const { logbook, written } = facade(entry({ kind: "daily" }));
  await logbook.saveEntryBody("e1", "Wrote up the results.");
  assert.equal(written[0]?.kind, "daily");
});

/**
 * A row that is gone is refused, and the refusal comes from the use case.
 *
 * The first version of this test asserted that the write *did* happen, which is
 * the opposite of its own name: the stub's `update` always resolved, so the
 * assertion passed without the use case being involved at all. The stub now
 * behaves like the real one — `NotFoundError` for an id it does not hold — and
 * the test checks that the facade neither swallows that nor invents a second
 * failure for it.
 */
test("an entry that is not there is refused by the use case, not papered over", async () => {
  const { logbook, written } = facade(null, { notFound: true });
  await assert.rejects(() => logbook.saveEntryBody("gone", "orphan"), /No log entry with id "gone"/);
  assert.equal(written.length, 0, "nothing should have been written");
});
