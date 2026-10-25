/**
 * Copying a shared note copies its images (26-11). One that cannot be copied
 * used to vanish without a word: the copy kept pointing at the owner's file.
 * Now it is named in the result.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { VaultPage } from "@weaveforge/core";

import { DuplicateSharedVaultPageUseCase } from "../application/duplicate-shared-vault.use-case";

function setup(failing: ReadonlySet<string>) {
  const body = "![a](vault:owner/a.png) ![b](vault:owner/b.png)";
  let saved: VaultPage | null = null;
  const useCase = new DuplicateSharedVaultPageUseCase({
    shares: { listSharedWithMe: async () => [{ resourceType: "vault_page", resourceId: "src", ownerId: "o" }] } as never,
    pages: { getById: async () => ({ id: "src", title: "T", body }) } as never,
    manageVaultPage: {
      add: async (input: { title: string; body: string }) => (saved = { id: "new", ...input } as VaultPage),
      update: async (id: string, patch: { body: string }) => (saved = { ...saved!, id, ...patch }),
    } as never,
    assets: {
      fetchBlob: async (path: string) => {
        if (failing.has(path)) throw new Error("gone");
        return new Blob(["x"]);
      },
      upload: async (_page: string, _blob: Blob, ext: string) => `mine/${Math.random().toString(36).slice(2)}.${ext}`,
    } as never,
  });
  return { useCase };
}

test("an image that cannot be copied is reported, the others rewritten", async () => {
  const { useCase } = setup(new Set(["owner/b.png"]));
  const { page, failedAssets } = await useCase.execute({ resourceId: "src", ownerId: "o" });
  assert.deepEqual(failedAssets, ["owner/b.png"]);
  assert.ok(!page.body.includes("vault:owner/a.png"));
  assert.ok(page.body.includes("vault:owner/b.png"));
});

test("a clean copy reports nothing", async () => {
  const { useCase } = setup(new Set());
  const { failedAssets } = await useCase.execute({ resourceId: "src", ownerId: "o" });
  assert.deepEqual(failedAssets, []);
});
