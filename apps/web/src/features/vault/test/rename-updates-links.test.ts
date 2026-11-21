/**
 * Renaming a note rewrites the links to it in every other note (F97 rename links).
 *
 * The Dev E2E renamed "E2E Note Two" with the explorer pencil; the tree and tab
 * followed, but "E2E Note One" still said [[E2E Note Two]]. No rename door
 * rewrote links, folder or no folder.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EditVaultPageInput, VaultPage } from "@weaveforge/core";
import { loadTestCore } from "@/lib/test/load-test-core";

import { withRenameLinkRewrite } from "../application/rename-updates-links";

before(loadTestCore);

function page(id: string, title: string, body: string): VaultPage {
  return { id, title, body, sortOrder: 0, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" };
}

/** Just the reads and the `update` the rewrite uses, over a map. */
function memoryPages(initial: VaultPage[], failOn: ReadonlySet<string> = new Set()) {
  const rows = new Map(initial.map((p) => [p.id, p]));
  const updates: string[] = [];
  const inputs: EditVaultPageInput[] = [];
  const reads: string[] = [];
  /** When set, `list` answers this snapshot: an edit saved after the list was read. */
  const stale: { list?: VaultPage[] } = {};
  const repo = {
    getById: async (id: string) => {
      reads.push(id);
      return rows.get(id) ?? null;
    },
    list: async () => stale.list ?? [...rows.values()],
    update: async (id: string, input: EditVaultPageInput) => {
      inputs.push(input);
      // As the Rust repo does (vault_pages::assert_title_unique), refuse another note's title.
      const taken = [...rows.values()].some((p) => p.id !== id && p.title.toLowerCase() === input.title?.toLowerCase());
      if (taken) throw new Error("A note with this title already exists.");
      if (failOn.has(id)) throw new Error("disk full");
      updates.push(id);
      const next = { ...rows.get(id)!, ...(input.title !== undefined && { title: input.title }), ...(input.body !== undefined && { body: input.body }) };
      rows.set(id, next);
      return next;
    },
  };
  return { rows, updates, inputs, reads, stale, repo: withRenameLinkRewrite(repo as never) as unknown as typeof repo };
}

test("renaming a note rewrites [[Old]] links in other notes", async () => {
  const { rows, repo } = memoryPages([
    page("one", "E2E Note One", "See [[E2E Note Two]], [[e2e note two|the second]] and [[E2E Note Two#Intro]]."),
    page("two", "E2E Note Two", "Body"),
  ]);
  await repo.update("two", { title: "E2E Note Renamed" });
  assert.equal(rows.get("two")!.title, "E2E Note Renamed");
  assert.equal(
    rows.get("one")!.body,
    "See [[E2E Note Renamed]], [[E2E Note Renamed|the second]] and [[E2E Note Renamed#Intro]].",
  );
});

test("a rename leaves notes without such a link untouched", async () => {
  const { updates, repo } = memoryPages([
    page("one", "One", "Links [[Other]] only."),
    page("two", "Two", "Body"),
    page("three", "Three", "No links."),
  ]);
  await repo.update("two", { title: "Renamed" });
  assert.deepEqual(updates, ["two"]);
});

test("an edit that keeps the title rewrites nothing", async () => {
  const { updates, repo } = memoryPages([page("one", "One", "[[Two]]"), page("two", "Two", "Body")]);
  await repo.update("two", { body: "New body" });
  await repo.update("two", { title: "Two" });
  assert.deepEqual(updates, ["two", "two"]);
});

test("links inside fenced or inline code are not rewritten", async () => {
  const { rows, repo } = memoryPages([
    page("one", "One", "```\n[[Two]]\n```\n`[[Two]]` and [[Two]]"),
    page("two", "Two", "Body"),
  ]);
  await repo.update("two", { title: "Renamed" });
  assert.equal(rows.get("one")!.body, "```\n[[Two]]\n```\n`[[Two]]` and [[Renamed]]");
});

test("a rename skips the rewrite while another note still has the old title", async () => {
  const { rows, updates, repo } = memoryPages([
    page("one", "One", "[[Two]]"),
    page("two", "Two", "Body"),
    page("dup", "two", "Same title, other case"),
  ]);
  await repo.update("two", { title: "Renamed" });
  assert.deepEqual(updates, ["two"]);
  assert.equal(rows.get("one")!.body, "[[Two]]");
});

test("a rename refused as a duplicate title rewrites nothing", async () => {
  const { rows, updates, repo } = memoryPages([page("one", "One", "[[Two]]"), page("two", "Two", "Body")]);
  await assert.rejects(repo.update("two", { title: "one" }), /already exists/);
  assert.equal(rows.get("one")!.body, "[[Two]]");
  assert.deepEqual(updates, []);
});

test("a note that fails to save is reported, the others are still rewritten", async () => {
  const { rows, repo } = memoryPages(
    [page("one", "One", "[[Two]]"), page("bad", "Bad", "[[Two]]"), page("three", "Three", "[[Two]]"), page("two", "Two", "Body")],
    new Set(["bad"]),
  );
  const saved = (await repo.update("two", { title: "Renamed" })) as { title: string; linkRewriteFailed?: string[] };
  assert.equal(saved.title, "Renamed");
  assert.deepEqual(saved.linkRewriteFailed, ["Bad"]);
  assert.equal(rows.get("one")!.body, "[[Renamed]]");
  assert.equal(rows.get("three")!.body, "[[Renamed]]");
  assert.equal(rows.get("bad")!.body, "[[Two]]");
});

test("a rename where every rewrite saved reports no failures", async () => {
  const { repo } = memoryPages([page("one", "One", "[[Two]]"), page("two", "Two", "Body")]);
  const saved = (await repo.update("two", { title: "Renamed" })) as { linkRewriteFailed?: string[] };
  assert.equal(saved.linkRewriteFailed, undefined);
});

test("the rewrite starts from the note as saved now and is version-guarded", async () => {
  const { rows, inputs, stale, repo } = memoryPages([page("one", "One", "[[Two]]"), page("two", "Two", "Body")]);
  stale.list = [...rows.values()];
  rows.set("one", page("one", "One", "[[Two]] and an edit saved since"));
  await repo.update("two", { title: "Renamed" });
  assert.equal(rows.get("one")!.body, "[[Renamed]] and an edit saved since");
  // baseBody makes the repo merge, or keep a conflict copy of, anything saved after this read.
  assert.deepEqual(inputs.at(-1), { body: "[[Renamed]] and an edit saved since", baseBody: "[[Two]] and an edit saved since" });
});

test("only notes that mention the old title, in any case or spacing, are read again", async () => {
  const { rows, reads, repo } = memoryPages([
    page("one", "One", "[[Other]] only"),
    page("three", "Three", "see [[old   TITLE]]"),
    page("two", "Old Title", "Body"),
  ]);
  await repo.update("two", { title: "Renamed" });
  assert.deepEqual(reads, ["two", "three"]);
  assert.equal(rows.get("three")!.body, "see [[Renamed]]");
});

test("the app's note writes are the link-rewriting ones", () => {
  const src = readFileSync(fileURLToPath(new URL("../../../create-app-container.ts", import.meta.url)), "utf8");
  assert.match(src, /const manageVaultPage = withRenameLinkRewrite\(vaultPageRepository\)/);
});
