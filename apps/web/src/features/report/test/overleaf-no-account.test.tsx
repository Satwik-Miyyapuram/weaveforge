import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { setContainerForTests } from "@/bootstrap";
import { loadCore } from "@/lib/rust-core";
import { OverleafWorkspace } from "../ui/overleaf-workspace";
import type { LinkedReportsGateway } from "../ui/use-linked-reports";
import type { WorkshopSessionStore } from "../ui/use-workshop-session";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// next/link prefetches through `self`, which node lacks.
(globalThis as { self?: unknown }).self ??= globalThis;

// A no-account copy. `local()` is remembered per process, so this file sets it
// before the first render and keeps its own process (node --test runs each file alone).
setContainerForTests({ auth: { isLocalMode: () => true } } as never);

test("no-account copy offers no Git-link action and shows no link copy", async () => {
  const store: WorkshopSessionStore = { get: () => null, set: () => {} };
  const gateway: LinkedReportsGateway = { list: async () => [], unlink: async () => {} };
  const client = {
    fetch: async () => new Response("{}"),
    authHeaders: async (extra: unknown) => ({ ...(extra as Record<string, string>) }),
  };
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(createElement(OverleafWorkspace, {
      client: client as never,
      store,
      inShell: false,
      canEditAsFiles: false,
      workshop: false,
      projectId: "wf1",
      gateway,
      picks: { get: () => null, set: () => {} },
      onExport: () => {},
    }));
  });
  const shown = JSON.stringify(tree?.toJSON());
  // The empty state still renders (not vacuous): the export action is there.
  assert.match(shown, /Export for Overleaf/);
  assert.doesNotMatch(shown, /Link a project/);
  assert.doesNotMatch(shown, /Git token/);
});