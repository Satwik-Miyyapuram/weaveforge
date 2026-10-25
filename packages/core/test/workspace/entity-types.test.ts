/**
 * The folder reader's type table comes from ENTITY_DIRS alone (06-05): a type
 * added there is read back from its frontmatter and from its directory.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkspaceFile } from "../../src/workspace/deserialize-workspace.js";
import { ENTITY_DIRS, type WorkspaceEntityType } from "../../src/workspace/folder-layout.js";

const types = Object.keys(ENTITY_DIRS) as WorkspaceEntityType[];
// An ink note is folded into the note it is stored as.
const readBack = (type: WorkspaceEntityType) => (type === "ink_page" ? "vault_page" : type);

test("every entity type declared in frontmatter is read back", () => {
  for (const type of types) {
    const parsed = parseWorkspaceFile("loose/x.md", `---\nweaveforge-type: ${type}\n---\nbody`);
    assert.equal(parsed?.type, readBack(type), type);
  }
  // An unknown declaration falls back to the directory.
  assert.equal(parseWorkspaceFile("papers/x.md", "---\nweaveforge-type: widget\n---\nb")?.type, "paper");
  assert.equal(parseWorkspaceFile("loose/x.md", "---\nweaveforge-type: widget\n---\nb"), null);
});

test("every entity directory names its type, at the root and inside a project", () => {
  for (const type of types) {
    const dir = ENTITY_DIRS[type];
    // `notes` holds ink notes too, but a plain file there is a note.
    const expected = dir === "notes" ? "vault_page" : type;
    assert.equal(parseWorkspaceFile(`${dir}/x.md`, "body")?.type, expected, dir);
    assert.equal(parseWorkspaceFile(`thesis--8d7317/${dir}/x.md`, "body")?.type, expected, dir);
  }
});
