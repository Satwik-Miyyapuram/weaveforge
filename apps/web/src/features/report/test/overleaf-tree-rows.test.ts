import assert from "node:assert/strict";
import { test } from "node:test";

import { loadOverleafTreeRows, SIGN_IN_ROW, type OverleafTreeDeps } from "../lib/overleaf-tree-rows";
import type { LinkedReport } from "../ui/linked-overleaf-api";

function linked(overleafId: string, title: string): LinkedReport {
  return {
    id: `r-${overleafId}`, project_id: "wf1", title, connection_id: "c1", overleaf_project_id: overleafId,
    entry_file: "main.tex", external_url: null, last_fetched_at: null, section_targets: {},
  };
}

function deps(over: Partial<OverleafTreeDeps> = {}): OverleafTreeDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    workshop: true,
    projectId: "wf1",
    sessionId: () => "s1",
    listAccount: async (id) => {
      asked.push(id);
      return { ok: true, projects: [{ id: "b", name: "Beta" }, { id: "a", name: "Alpha" }] };
    },
    listLinked: async () => [],
    picked: () => null,
    ...over,
  };
}

test("signed in, the account's projects are the rows, by name", async () => {
  assert.deepEqual(await loadOverleafTreeRows(deps()), [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }]);
});

test("linked projects come first and stay even when not picked", async () => {
  const d = deps({ listLinked: async () => [linked("z", "Zed thesis")], picked: () => ["b"] });
  assert.deepEqual(await loadOverleafTreeRows(d), [{ id: "z", name: "Zed thesis" }, { id: "b", name: "Beta" }]);
});

test("signed out with nothing linked there is one row, to sign in, and no Overleaf request", async () => {
  const d = deps({ sessionId: () => null });
  assert.deepEqual(await loadOverleafTreeRows(d), [SIGN_IN_ROW]);
  assert.deepEqual(d.asked, []);
});

test("without sign-in routes the account is not asked; linked rows still show", async () => {
  const d = deps({ workshop: false, listLinked: async () => [linked("z", "Zed")] });
  assert.deepEqual(await loadOverleafTreeRows(d), [{ id: "z", name: "Zed" }]);
  assert.deepEqual(d.asked, []);
});

test("a failed account list or linked list falls back, not throws", async () => {
  const d = deps({
    listAccount: async () => ({ ok: false, expired: true, message: "gone" }),
    listLinked: async () => { throw new Error("offline"); },
  });
  assert.deepEqual(await loadOverleafTreeRows(d), [SIGN_IN_ROW]);
  const throws = deps({ listAccount: async () => { throw new Error("offline"); } });
  assert.deepEqual(await loadOverleafTreeRows(throws), [SIGN_IN_ROW]);
});

test("no open WeaveForge project means no linked lookup", async () => {
  let looked = false;
  const d = deps({ projectId: null, listLinked: async () => { looked = true; return []; } });
  assert.equal((await loadOverleafTreeRows(d)).length, 2);
  assert.equal(looked, false);
});

test("signed in with every project hidden by the picks, the folder is empty", async () => {
  assert.deepEqual(await loadOverleafTreeRows(deps({ picked: () => [] })), []);
});
