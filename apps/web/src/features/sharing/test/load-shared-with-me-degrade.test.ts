/**
 * Shared with me reads one source per shareable type. 1.0.0 retires the personal
 * tables those reads select from (0165/0167), so one source can fail with a missing
 * table while the others still answer. The screen keeps the other items:
 * - a missing table (PostgREST 404 PGRST205, or Postgres 42P01) reads as empty, but only
 *   for the types whose table 1.0.0 drops; elsewhere it is unavailable and logged;
 * - any other failure of one source is listed in `unavailable` so the screen can say so;
 * - when every source fails, the error still reaches the screen as before.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { LoadSharedWithMeScreenUseCase } from "@/features/sharing/application/parts";
import type { ISharedReader, SharedItem } from "@/features/sharing/domain/shared-reader";
import type { Share, ShareableType } from "@weaveforge/core";

const share = (resourceType: ShareableType, resourceId: string): Share => ({
  id: `s-${resourceId}`,
  ownerId: "owner",
  recipientId: "me",
  resourceType,
  resourceId,
  access: "comment",
  createdAt: "2026-11-23T00:00:00Z",
});

const SHARES = [share("paper", "p1"), share("vault_page", "n1")];

const item = (kind: ShareableType, id: string): SharedItem => ({
  id,
  kind,
  title: `t-${id}`,
  status: "",
  ownerId: "owner",
});

/** A reader whose answer per type is given; an Error or error object rejects that type only. */
function reader(answers: Partial<Record<ShareableType, unknown>>): ISharedReader {
  return {
    async read(kind, ids) {
      const answer = answers[kind];
      if (answer !== undefined && !Array.isArray(answer)) throw answer;
      return ids.map((id) => item(kind, id));
    },
  };
}

const noRows = { getById: async () => null, listByIds: async () => [] } as never;

function useCase(sharedReader: ISharedReader) {
  return new LoadSharedWithMeScreenUseCase({
    sharing: { listSharedWithMe: async () => SHARES } as never,
    members: { listDirectory: async () => [] } as never,
    sharedReader,
    papers: noRows,
    experiments: noRows,
    vaultPages: noRows,
    readingLists: noRows,
  });
}

const ids = (items: SharedItem[]) => items.map((i) => `${i.kind}:${i.id}`).sort();

test("normal path: every source answers, all items shown, nothing unavailable", async () => {
  const data = await useCase(reader({})).execute();
  assert.deepEqual(ids(data.items), ["paper:p1", "vault_page:n1"]);
  assert.deepEqual(data.unavailable, []);
});

test("a dropped table (PostgREST 404 PGRST205) reads as empty; the other items still show", async () => {
  const data = await useCase(
    reader({
      paper: { code: "PGRST205", message: "Could not find the table 'public.papers' in the schema cache" },
    }),
  ).execute();
  assert.deepEqual(ids(data.items), ["vault_page:n1"]);
  assert.deepEqual(data.unavailable, []);
});

test("a dropped table (Postgres 42P01) reads as empty; the other items still show", async () => {
  const data = await useCase(
    reader({ paper: { code: "42P01", message: 'relation "public.papers" does not exist' } }),
  ).execute();
  assert.deepEqual(ids(data.items), ["vault_page:n1"]);
  assert.deepEqual(data.unavailable, []);
});

test("one source failing otherwise is reported as unavailable; the other items still show", async () => {
  const data = await useCase(reader({ paper: new Error("network down") })).execute();
  assert.deepEqual(ids(data.items), ["vault_page:n1"]);
  assert.deepEqual(data.unavailable, ["paper"]);
});

test("a missing table outside the held-drop set (e.g. stale schema cache) is unavailable and logged", async () => {
  const logs: { level: string; source: string; message: string }[] = [];
  const g = globalThis as { window?: unknown };
  const before = g.window;
  g.window = { weaveforge: { fetchTitle: () => {}, reportAppLog: (line: never) => logs.push(line) } };
  try {
    const shares = [share("experiment", "e1"), share("vault_page", "n1")];
    const data = await new LoadSharedWithMeScreenUseCase({
      sharing: { listSharedWithMe: async () => shares } as never,
      members: { listDirectory: async () => [] } as never,
      sharedReader: reader({
        experiment: { code: "PGRST205", message: "Could not find the table 'public.experiments' in the schema cache" },
      }),
      papers: noRows,
      experiments: noRows,
      vaultPages: noRows,
      readingLists: noRows,
    }).execute();
    assert.deepEqual(ids(data.items), ["vault_page:n1"]);
    assert.deepEqual(data.unavailable, ["experiment"]);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.level, "warn");
    assert.match(logs[0]?.message ?? "", /experiment/);
  } finally {
    g.window = before;
  }
});

test("every source failing still rejects, so the screen shows its error as before", async () => {
  const down = new Error("network down");
  const all = Object.fromEntries(
    ["milestone", "experiment", "report_section", "reading_list", "paper", "vault_page"].map((t) => [t, down]),
  );
  await assert.rejects(useCase(reader(all)).execute(), /network down/);
});
