import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceFacade } from "../facades";

/**
 * The snapshot must read repositories directly. Reading through the screen
 * facades — or through any summary/projection method — is what shipped an
 * export full of empty notes and no attachments, because the card projections
 * drop note bodies and paper abstract/bibtex/metadata.
 *
 * These assert the call *shape*, so a later refactor that swaps a repository
 * for a facade or reaches for a summary reader fails here rather than silently
 * emptying every export and search index built on the snapshot.
 */

const READER_KEYS = [
  "papers",
  "vaultPages",
  "readingLists",
  "reportSections",
  "experiments",
  "milestones",
  "logEntries",
  "relations",
  "tags",
] as const;

/** Records which method each reader was asked for. */
function spyDeps() {
  const calls = new Map<string, string[]>();
  const record = (key: string, method: string) => {
    calls.set(key, [...(calls.get(key) ?? []), method]);
  };

  const reader = (key: string) =>
    new Proxy(
      {
        list: async () => {
          record(key, "list");
          return [];
        },
      },
      {
        // Any method the facade reaches for that is not `list` is recorded and
        // then fails loudly — including `listSummaries`.
        get(target, prop: string) {
          if (prop in target) return target[prop as "list"];
          return async () => {
            record(key, prop);
            return [];
          };
        },
      },
    );

  const deps = Object.fromEntries(READER_KEYS.map((key) => [key, reader(key)]));
  return {
    calls,
    deps: {
      ...deps,
      readingListItems: {
        listItemsForLists: async (ids: readonly string[]) => {
          record("readingListItems", `listItemsForLists(${ids.length})`);
          return [];
        },
      },
    } as never,
  };
}

test("reads every entity through list(), never a summary projection", async () => {
  const { calls, deps } = spyDeps();

  await new WorkspaceFacade(deps).snapshot();

  for (const key of READER_KEYS) {
    assert.deepEqual(calls.get(key), ["list"], `${key} was not read with a single list() call`);
  }
});

test("no reader is asked for listSummaries", async () => {
  const { calls, deps } = spyDeps();

  await new WorkspaceFacade(deps).snapshot();

  const summaryCalls = [...calls.entries()].filter(([, methods]) =>
    methods.some((method) => method.toLowerCase().includes("summ")),
  );
  assert.deepEqual(summaryCalls, [], "a summary projection was used to build the snapshot");
});

test("covers every entity the export and search index depend on", async () => {
  const { calls, deps } = spyDeps();

  await new WorkspaceFacade(deps).snapshot();

  // Guards silent shrinkage: dropping a reader here would quietly remove that
  // entity from exports, the folder mirror, and the search index at once.
  assert.deepEqual([...calls.keys()].sort(), [...READER_KEYS, "readingListItems"].sort());
});

test("fetches reading-list membership for the lists it collected", async () => {
  const calls: string[] = [];
  const deps = {
    ...Object.fromEntries(
      READER_KEYS.map((key) => [
        key,
        { list: async () => (key === "readingLists" ? [{ id: "l1" }, { id: "l2" }] : []) },
      ]),
    ),
    readingListItems: {
      listItemsForLists: async (ids: readonly string[]) => {
        calls.push(ids.join(","));
        return [];
      },
    },
  } as never;

  await new WorkspaceFacade(deps).snapshot();

  assert.deepEqual(calls, ["l1,l2"]);
});
