import { test } from "node:test";
import assert from "node:assert/strict";

import { VaultFacade } from "../facades/vault";

type Deps = ConstructorParameters<typeof VaultFacade>[0];

test("pageTitles reads note summaries only, not the whole screen (34-23)", async () => {
  let summaries = 0;
  const deps = {
    load: { execute: () => assert.fail("screen load must not run") },
    pages: {
      listSummaries: async () => {
        summaries += 1;
        return [{ title: "A" }, { title: "B b" }];
      },
    },
  } as unknown as Deps;
  assert.deepEqual(await new VaultFacade(deps).pageTitles(), ["A", "B b"]);
  assert.equal(summaries, 1);
});

test("pageTitles is empty for a project with no notes (34-23)", async () => {
  const deps = { pages: { listSummaries: async () => [] } } as unknown as Deps;
  assert.deepEqual(await new VaultFacade(deps).pageTitles(), []);
});
