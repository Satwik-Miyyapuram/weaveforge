/**
 * Adding a paper asks for its PDF (explorer plan §8).
 *
 * The bulk walk runs when a folder is adopted, so the paper imported *after*
 * that — a local Zotero pull, a DOI resolved from the add form — is what this
 * covers. The prefetch is injected rather than reached for, which is the whole
 * reason the decorator takes it: the interesting fact is *which* paper is asked
 * for and *when*, and neither needs a folder, a container or a network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { IPaperRepository, NewPaperInput, Paper } from "@weaveforge/core";

import { PrefetchingAddPaperUseCase } from "../application/prefetch-paper-pdf.use-case";

/** A repository that keeps what it is handed and finds no duplicates. */
function repository() {
  const saved: Paper[] = [];
  return {
    saved,
    save: async (paper: Paper) => {
      saved.push(paper);
    },
    findByArxivId: async () => null,
    findByDoi: async () => null,
  } as unknown as IPaperRepository & { saved: Paper[] };
}

function useCase(prefetch: (id: string) => void) {
  const repo = repository();
  return {
    repo,
    add: new PrefetchingAddPaperUseCase(
      {
        repository: repo,
        clock: { nowIso: () => "2026-01-01T00:00:00.000Z" },
        ids: { newId: () => "paper-1" },
      },
      prefetch,
    ),
  };
}

test("a manually added paper asks for its PDF, after the paper exists", async () => {
  const asked: string[] = [];
  const { repo, add } = useCase((id) => asked.push(id));

  const paper = await add.addManual({ title: "Attention" } satisfies NewPaperInput);

  assert.equal(paper.id, "paper-1");
  assert.equal(repo.saved.length, 1);
  assert.deepEqual(asked, ["paper-1"]);
});

test("a prefetch that throws does not take the added paper down with it", async () => {
  const { add } = useCase(() => {
    throw new Error("no folder");
  });

  const paper = await add.addManual({ title: "Attention" });
  assert.equal(paper.id, "paper-1");
});
