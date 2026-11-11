import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { createdPageIndex } from "../src/index.js";
import { groupProposals } from "../src/proposal-groups.js";
import {
  shouldMountShellChildren,
  shouldShowWorkspaceLoader,
} from "../src/privacy-disclaimer-readiness.js";
import { railGroupText } from "../src/index.js";
import { semanticStatusText } from "../src/index.js";
import { conflictRoute } from "../src/index.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

test("groupProposals groups unknown targets under their kind", () => {
  const items = [
    { kind: "create_log_entry", resourceId: "rand-1" },
    { kind: "append_paper_note", resourceId: "paper-1" },
    { kind: "create_log_entry", resourceId: "rand-2" },
  ];
  assert.deepEqual(groupProposals(items, "document", ["paper-1"]), [
    { key: "kind:create_log_entry", indices: [0, 2] },
    { key: "paper-1", indices: [1] },
  ]);
  assert.deepEqual(
    groupProposals(
      [
        { kind: "relation", resourceId: "paper-2" },
        { kind: "relation", resourceId: "paper-9" },
      ],
      "kind",
    ),
    [{ key: "relation", indices: [0, 1] }],
  );
});

test("createdPageIndex finds the page by trimmed title and parent", () => {
  const pages = [{ title: "Adam" }, { title: "Adam", parentId: "wiki" }];
  assert.equal(
    createdPageIndex(
      {
        kind: "create_vault_note",
        payload: { title: "  Adam ", parentId: "wiki" },
      },
      pages,
    ),
    1,
  );
  assert.equal(
    createdPageIndex(
      { kind: "create_vault_note", payload: { title: "Adam" } },
      [{ title: "Adam", parentId: "wiki" }],
    ),
    null,
  );
});

test("shell gates mount children and show the loader from the same flags", () => {
  assert.equal(shouldMountShellChildren(false, false, true), true);
  assert.equal(shouldMountShellChildren(true, false, true), false);
  assert.equal(shouldMountShellChildren(false, true, true), false);
  assert.equal(shouldShowWorkspaceLoader(true, false, false), true);
  assert.equal(shouldShowWorkspaceLoader(false, false, false, "boom"), false);
});

test("railGroupText names only visible tabs and switches the label", () => {
  const group = {
    label: "Accounts",
    labelWithout: { tab: "lab", label: "Account" },
    hints: [
      ["lab", "lab"],
      ["integrations", "ignored"],
      ["calendar", "calendar"],
    ] satisfies [string, string][],
  };
  assert.deepEqual(railGroupText(group, ["lab", "calendar"], ["GitHub"]), {
    label: "Accounts",
    hint: "Lab, calendar",
  });
  assert.deepEqual(railGroupText(group, [], []), {
    label: "Account",
    hint: "",
  });
});

test("semanticStatusText words the downloading and ready states", () => {
  assert.equal(
    semanticStatusText({ phase: "downloading", loaded: 1, total: 2 }),
    "Downloading the model — 50%",
  );
  assert.equal(
    semanticStatusText({
      phase: "ready",
      passages: 3,
      model: "MiniLM",
      fallback: true,
    }),
    "On — 3 passages searchable by meaning (MiniLM). New and edited items are added as you work. The app's own encoder did not load, so the browser's is used.",
  );
});

test("conflictRoute picks the pump step for a refused op", () => {
  assert.deepEqual(
    conflictRoute({
      op: "update",
      serverVersion: 4,
      serverRow: "absent",
      deletedElsewhere: false,
      hasStore: true,
    }),
    {
      action: "reinsert",
      reason: "The server never got this row; sending it whole.",
    },
  );
  assert.deepEqual(
    conflictRoute({
      op: "insert",
      serverVersion: 4,
      serverRow: "absent",
      deletedElsewhere: null,
      hasStore: true,
    }),
    {
      action: "fail",
      reason: "The server refused this new row; it is kept and retried.",
      rebaseTo: null,
    },
  );
});
