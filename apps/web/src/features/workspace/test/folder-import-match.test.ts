/**
 * A folder file that lost its `weaveforge-id` is matched back to the note it
 * came from, never imported as a second note under a new id: first by the path
 * the mirror writes that note to, then by an identical body.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { AppContainer } from "@/bootstrap";
import { setContainerForTests } from "@/bootstrap";
import type { ImportDiffEntry } from "@weaveforge/wasm";
import { loadTestCore } from "@/lib/test/load-test-core";
import { diffAgainstWorkspace } from "../application/parts-1";

const NOTE_ID = "4e64e8a9-cb73-418a-9909-00c3507060c3";
const PROJECT = { id: "p1", name: "Thesis" };
const PAGE = {
  id: NOTE_ID,
  title: "Method",
  body: "We ran three seeds.",
  createdAt: "2026-11-18T14:45:32.123Z",
  updatedAt: "2026-11-18T14:45:32.123Z",
};

let notePath = "";
let noteFile = "";

before(async () => {
  // The mirror's writer, typed as parts-1 uses it (the test core's type leaves it out).
  const core = (await loadTestCore()) as unknown as {
    serializeWorkspace(snapshot: unknown, project: typeof PROJECT): { files: Record<string, string> };
  };
  const { files } = core.serializeWorkspace({ vaultPages: [PAGE], papers: [] }, PROJECT);
  const found = Object.entries(files).find(([, text]) => text.includes(`weaveforge-id: ${NOTE_ID}`));
  assert.ok(found, "the mirror writes the note with its id");
  [notePath, noteFile] = found;
  setContainerForTests({
    workspace: { snapshot: async () => ({ vaultPages: [PAGE], papers: [] }) },
  } as unknown as AppContainer);
});

after(() => setContainerForTests(null));

const withoutId = (text: string) => text.replace(/^weaveforge-id:.*\r?\n/m, "");

test("a file whose frontmatter id was deleted is the same note, matched by its path", async () => {
  const edited = withoutId(noteFile).replace("three", "five");
  assert.ok(!edited.includes(NOTE_ID));

  const diff = await diffAgainstWorkspace({ [notePath]: edited }, new Map(), PROJECT);
  const entry = diff.entries.find((e: ImportDiffEntry) => e.entity.path === notePath);
  assert.equal(entry?.action, "updated");
  assert.equal(entry?.entity.id, NOTE_ID);
  assert.equal(diff.counts.created ?? 0, 0);
});

test("a file moved and stripped of its id is the same note, matched by its body", async () => {
  const moved = notePath.replace(/\/([^/]+)$/, "/archive/$1");
  const diff = await diffAgainstWorkspace({ [moved]: withoutId(noteFile) }, new Map(), PROJECT);
  const entry = diff.entries.find((e: ImportDiffEntry) => e.entity.path === moved);
  assert.equal(entry?.entity.id, NOTE_ID);
  assert.notEqual(entry?.action, "created");
  assert.equal(diff.counts.created ?? 0, 0);
});
