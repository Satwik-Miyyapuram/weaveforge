import assert from "node:assert/strict";
import { test } from "node:test";

import { appText, missingNames, parseAllow, stepNames } from "../ui-names.mjs";

test("stepNames takes bold names from numbered steps only", () => {
  const md = `Some **emphasis** in a paragraph.

1. Click **Save**, then **Close**.
2. Open the menu
   and pick **Export**.

- **Not a step** in a bullet list.
`;
  assert.deepEqual(stepNames(md), ["Save", "Close", "Export"]);
});

test("stepNames reads a bold name that wraps onto the next line", () => {
  const md = `1. Type it into **New
   password**, and press **Set new password**.
`;
  assert.deepEqual(stepNames(md), ["New password", "Set new password"]);
});

test("stepNames skips a bold lead-in that opens an item", () => {
  const md = `1. **Get a key**: click **Generate**.
   - **Optional**: pick **Collection**.
`;
  assert.deepEqual(stepNames(md), ["Generate", "Collection"]);
});

test("stepNames splits a menu path and drops key names and generated blocks", () => {
  const md = `1. Open **Settings → Workspace**, press **\`Ctrl+P\`**.
<!-- generated:x -->
2. Click **Made up**.
<!-- /generated:x -->
`;
  assert.deepEqual(stepNames(md), ["Settings", "Workspace"]);
});

test("appText decodes entities, apostrophes and spacing", () => {
  assert.equal(appText(["<b>Today&apos;s\n   reading</b>", "it’s"]), "<b>Today's reading</b> it's");
});

test("missingNames matches literal labels and placeholders", () => {
  const app = appText([
    '<button>Save</button> label="Can edit"',
    "{`Send ${selected.size} for review`}",
    "<h3>Check-ins ({snapshots.length})</h3>",
    "aria-label={`More actions for ${name}`}",
  ]);
  assert.deepEqual(
    missingNames(["Save", "Can edit", "Send N for review", "Check-ins (N)", "More actions for <name>"], app, new Set()),
    [],
  );
  assert.deepEqual(missingNames(["Sav", "an edit"], app, new Set()), ["Sav", "an edit"]);
  assert.deepEqual(missingNames(["Delete", "Can view"], app, new Set(["Can view"])), ["Delete"]);
});

test("missingNames does not let a placeholder swallow a whole line", () => {
  const app = appText(["Send it now", "and later for review"]);
  assert.deepEqual(missingNames(["Send N for review"], app, new Set()), ["Send N for review"]);
});

test("parseAllow reads one name per line and ignores comments", () => {
  const txt = "# third-party\nRun anyway   # Windows SmartScreen\n\nPen (P)\n";
  assert.deepEqual([...parseAllow(txt)], ["Run anyway", "Pen (P)"]);
});
