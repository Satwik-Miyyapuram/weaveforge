import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { IPaperRepository, IReadingListItemRepository, IReadingListRepository, IVaultPageRepository } from "@weaveforge/core";
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
