/**
 * A merge applies only to the pages the preview showed (P1-3). An edit made
 * between preview and apply used to be overwritten by the merged text, and the
 * secondary page removed with it.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { MergeResult, VaultPage } from "@weaveforge/core";
import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import { applyMerge } from "../application/wiki-build";

before(loadTestCore);
after(() => setContainerForTests(null));

function page(id: string, updatedAt: string): VaultPage {
  return { id, title: id, body: `${id} body`, sortOrder: 0, createdAt: "2026-11-01T00:00:00Z", updatedAt };
}

function fakeVault(pages: VaultPage[]) {
  const calls: string[] = [];
  setContainerForTests({
    vault: {
      getPage: async (id: string) => pages.find((p) => p.id === id) ?? null,
      manageVaultPage: {
        update: async (id: string) => void calls.push(`update ${id}`),
        remove: async (id: string) => void calls.push(`remove ${id}`),
      },
    },
  } as never);
  return calls;
}

const merged = { title: "A", body: "merged", aliases: ["B"] } as unknown as MergeResult;
const T1 = "2026-11-02T00:00:00Z";
const T2 = "2026-11-03T00:00:00Z";

test("a merge of the pages the preview read writes the primary and removes the secondary", async () => {
  const calls = fakeVault([page("A", T1), page("B", T1)]);
  await applyMerge("A", "B", merged, { primaryUpdatedAt: T1, secondaryUpdatedAt: T1 });
  assert.deepEqual(calls, ["update A", "remove B"]);
});

for (const changed of ["A", "B"]) {
  test(`a merge after page ${changed} changed is refused and writes nothing`, async () => {
    const calls = fakeVault([page("A", changed === "A" ? T2 : T1), page("B", changed === "B" ? T2 : T1)]);
    await assert.rejects(
      applyMerge("A", "B", merged, { primaryUpdatedAt: T1, secondaryUpdatedAt: T1 }),
      /changed since the preview/,
    );
    assert.deepEqual(calls, []);
  });
}
