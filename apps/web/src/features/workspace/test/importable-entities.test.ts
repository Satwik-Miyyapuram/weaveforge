import assert from "node:assert/strict";
import { test } from "node:test";

import { importableEntities } from "../application/workspace-folder";

test("experiment and paper files are not offered as new notes", () => {
  const parsed = [
    { type: "vault_page", id: null, path: "p/notes/new.note.md" },
    { type: "experiment", id: "e1", path: "p/experiments/run.experiment.md" },
    { type: "paper", id: null, path: "p/papers/x.paper.md" },
    // An id this workspace holds as a note stays, so a type mismatch is still reported.
    { type: "paper", id: "n1", path: "p/notes/moved.md" },
  ];
  assert.deepEqual(
    importableEntities(parsed, new Set(["n1"])).map((entity) => entity.path),
    ["p/notes/new.note.md", "p/notes/moved.md"],
  );
});
