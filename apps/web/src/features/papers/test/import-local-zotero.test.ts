import assert from "node:assert/strict";
import test from "node:test";

import type { Paper } from "@weaveforge/core";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { ImportLocalZoteroUseCase } from "../application/import-local-zotero.use-case";

/**
 * The local-Zotero workflow, driven with a bridge a test supplies.
 *
 * This is the point of extracting it: it used to be a method on `PapersFacade`
 * that reached for `desktop()` itself, so the only way to exercise any part of it
 * — including the "you are not in the desktop app" branch, which is what a
 * browser user hits — was to have an Electron shell on the other side.
 */

const PAPER = {
  key: "PAPER1",
  itemType: "preprint",
  title: "Attention Is All You Need",
  DOI: "10.48550/arXiv.1706.03762",
  creators: [{ firstName: "Ashish", lastName: "Vaswani" }],
};

function reply(body: unknown, count = 0) {
  return {
    status: 200,
    body: JSON.stringify(body),
    headers: { "Total-Results": String(count) },
  };
}

/** Answers items with the canned library and everything else with nothing. */
function bridgeWithLibrary(): DesktopBridge {
  return {
    zoteroLocal: async (url: string) => {
      if (url.includes("itemType=annotation") || url.includes("itemType=attachment")) {
        return reply([], 0);
      }
      const items = [{ data: PAPER }];
      return reply(items, items.length);
    },
  } as unknown as DesktopBridge;
}

function harness(options: { bridge?: () => Promise<DesktopBridge | null> } = {}) {
  const added: string[] = [];
  const useCase = new ImportLocalZoteroUseCase({
    papers: { list: async () => [] } as never,
    addPaper: {
      addManual: async (input: { title: string }) => {
        added.push(input.title);
        return { id: "p1", title: input.title, metadata: {} } as unknown as Paper;
      },
    } as never,
    manageTags: { reconcileSources: async () => {} } as never,
    bridge: options.bridge ?? (async () => bridgeWithLibrary()),
  });
  return { useCase, added };
}

test("outside the desktop app the answer is a sentence, not a crash", async () => {
  const { useCase, added } = harness({ bridge: async () => null });

  await assert.rejects(() => useCase.execute(), (error: Error) => {
    assert.match(error.message, /desktop app/);
    return true;
  });
  assert.deepEqual(added, [], "nothing is read and nothing is written");
});

test("the injected bridge is the one that is used", async () => {
  // No hidden `desktop()` lookup: a bridge that cannot reach Zotero produces the
  // message the reader can act on, which only happens if this bridge was called.
  // The message now carries the bridge's own reason in brackets, so this matches
  // the sentence rather than comparing to it — the identity of the error class
  // changed when the cause stopped being thrown away.
  const { useCase } = harness({
    bridge: async () =>
      ({
        zoteroLocal: async () => {
          throw new Error("connect ECONNREFUSED 127.0.0.1:23119");
        },
      }) as unknown as DesktopBridge,
  });

  await assert.rejects(() => useCase.execute(), (error: Error) => {
    assert.match(error.message, /Zotero is not answering on this computer/);
    assert.match(error.message, /ECONNREFUSED/);
    return true;
  });
});

test("an item not yet in the library becomes a paper", async () => {
  const { useCase, added } = harness();

  const result = await useCase.execute();

  assert.deepEqual(added, ["Attention Is All You Need"]);
  assert.equal(result.papers, 1, "the count the screen reads out");
  assert.equal(typeof result.annotations, "number");
  assert.equal(typeof result.items, "number");
});
