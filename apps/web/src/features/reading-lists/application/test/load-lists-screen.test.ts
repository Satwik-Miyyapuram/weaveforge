import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { IPaperRepository, IReadingListItemRepository, IReadingListRepository, IVaultPageRepository } from "@weaveforge/core";
import type { AppLogInput } from "@/lib/error-report/app-log";
import { loadTestCore } from "@/lib/test/load-test-core";
import { LoadReadingListsScreenUseCase } from "../parts";

before(loadTestCore);

test("the lists screen reports the papers and notes whose lists value it cannot read", async () => {
  const unreadable = ["thesis/papers/broken.paper.md"];
  const useCase = new LoadReadingListsScreenUseCase({
    lists: { list: async () => [], getById: async () => null } as unknown as IReadingListRepository,
    papers: { list: async () => [] } as unknown as IPaperRepository,
    notes: { list: async () => [] } as unknown as IVaultPageRepository,
    listItems: { unreadablePaths: async () => unreadable } as unknown as IReadingListItemRepository,
  });
  const data = await useCase.execute();
  assert.deepEqual(data.unreadablePaths, unreadable);
});

test("the lists screen reports none when the repository has no unreadable papers", async () => {
  const useCase = new LoadReadingListsScreenUseCase({
    lists: { list: async () => [], getById: async () => null } as unknown as IReadingListRepository,
    papers: { list: async () => [] } as unknown as IPaperRepository,
    notes: { list: async () => [] } as unknown as IVaultPageRepository,
  });
  const data = await useCase.execute();
  assert.deepEqual(data.unreadablePaths, []);
});

test("the lists screen reports the legacy leftovers the list repository holds", async () => {
  const leftovers = [{ listId: "l1", state: "unresolved" as const, legacyLink: "[[Ghost.paper]]" }];
  const useCase = new LoadReadingListsScreenUseCase({
    lists: { list: async () => [], getById: async () => null } as unknown as IReadingListRepository,
    papers: { list: async () => [] } as unknown as IPaperRepository,
    notes: { list: async () => [] } as unknown as IVaultPageRepository,
    listItems: { legacyLeftovers: async () => leftovers } as unknown as IReadingListItemRepository,
  });
  const data = await useCase.execute();
  assert.deepEqual(data.legacyLeftovers, leftovers);
});

test("a failing legacy-leftover read keeps the screen loaded, shows none, and logs the failure", async () => {
  const logged: AppLogInput[] = [];
  const useCase = new LoadReadingListsScreenUseCase({
    lists: { list: async () => [], getById: async () => null } as unknown as IReadingListRepository,
    papers: { list: async () => [] } as unknown as IPaperRepository,
    notes: { list: async () => [] } as unknown as IVaultPageRepository,
    listItems: {
      legacyLeftovers: async () => {
        throw new Error("disk gone");
      },
    } as unknown as IReadingListItemRepository,
    report: (input) => logged.push(input),
  });
  const data = await useCase.execute();
  assert.deepEqual(data.legacyLeftovers, []);
  assert.deepEqual(data.lists, []);
  assert.equal(logged.length, 1);
  assert.equal(logged[0]!.level, "warn");
  assert.equal(logged[0]!.detail, "disk gone");
});

test("the lists screen reports no legacy leftovers when the repository has none", async () => {
  const useCase = new LoadReadingListsScreenUseCase({
    lists: { list: async () => [], getById: async () => null } as unknown as IReadingListRepository,
    papers: { list: async () => [] } as unknown as IPaperRepository,
    notes: { list: async () => [] } as unknown as IVaultPageRepository,
  });
  const data = await useCase.execute();
  assert.deepEqual(data.legacyLeftovers, []);
});
