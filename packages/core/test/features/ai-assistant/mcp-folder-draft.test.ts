import assert from "node:assert/strict";
import { test } from "node:test";

import { FOLDER_DRAFTS_DIR, parseFolderDraft } from "../../../src/features/ai-assistant/index.js";

const valid = {
  kind: "edit_vault_note",
  tool: "suggest_note_edit",
  resourceId: "note-1",
  resourceType: "vault_page",
  content: "Replace the intro",
  payload: { body: "New intro" },
  expectedRevision: "2026-01-01T00:00:00Z",
};

test("drafts live under the workspace meta folder", () => {
  assert.equal(FOLDER_DRAFTS_DIR, ".weaveforge/proposals");
});

test("a well-formed draft parses with its fields", () => {
  const draft = parseFolderDraft(JSON.stringify(valid));
  assert.equal(draft?.kind, "edit_vault_note");
  assert.equal(draft?.resourceId, "note-1");
  assert.deepEqual(draft?.payload, { body: "New intro" });
  assert.equal(draft?.expectedRevision, "2026-01-01T00:00:00Z");
});

test("a draft without a tool is marked as from the local MCP", () => {
  const { tool: _tool, ...rest } = valid;
  assert.equal(parseFolderDraft(JSON.stringify(rest))?.tool, "local-mcp");
});

test("anything that is not a draft is refused", () => {
  const bad: unknown[] = [
    "not json",
    "[]",
    { ...valid, kind: "delete_everything" },
    { ...valid, resourceId: "" },
    { ...valid, resourceId: "x".repeat(513) },
    { ...valid, content: "   " },
    { ...valid, payload: ["a"] },
    { ...valid, sourceLinks: [1] },
  ];
  for (const input of bad) {
    const raw = typeof input === "string" ? input : JSON.stringify(input);
    assert.equal(parseFolderDraft(raw), null, raw.slice(0, 60));
  }
  assert.equal(parseFolderDraft(JSON.stringify({ ...valid, content: "x".repeat(300_000) })), null);
});
