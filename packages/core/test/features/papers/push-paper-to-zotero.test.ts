import assert from "node:assert/strict";
import { test } from "node:test";

import { PushPaperToZoteroUseCase, type Paper } from "../../../src/index.js";

/**
 * The one push-to-Zotero rule.
 *
 * It used to be written twice — in the papers facade and as a callback in the
 * composition root — and the copies had drifted on the part that matters: one
 * wrapped the push in a try/catch and reported nothing, the other let the error
 * escape a *confirmed* AI proposal after the paper had already been added. These
 * tests pin the behaviour that both copies now share, including the failure.
 */

function paper(over: Partial<Paper> = {}): Paper {
  return {
    id: "p1",
    title: "Attention Is All You Need",
    authors: [],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function harness(options: { key?: string; throws?: boolean; linked?: boolean } = {}) {
  const saved: Paper[] = [];
  const pushed: string[] = [];
  const useCase = new PushPaperToZoteroUseCase({
    papers: {
      save: async (value) => {
        saved.push(value);
      },
    } as never,
    bibliography: {
      pushPaper: async (value) => {
        pushed.push(value.title);
        if (options.throws) throw new Error("zotero is down");
        return options.key;
      },
    } as never,
  });
  return { useCase, saved, pushed };
}

test("a paper already carrying a key is not pushed again", async () => {
  const { useCase, saved, pushed } = harness({ linked: true });

  const outcome = await useCase.execute(paper({ metadata: { zoteroKey: "ABCD" } }));

  assert.equal(outcome, "already-linked");
  assert.deepEqual(pushed, [], "pushing again would duplicate the item");
  assert.deepEqual(saved, []);
});

test("a successful push stores the key and keeps the rest of the metadata", async () => {
  const { useCase, saved } = harness({ key: "NEWKEY" });

  const outcome = await useCase.execute(paper({ metadata: { images: ["a.png"] } }));

  assert.equal(outcome, "pushed");
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0]!.metadata, { images: ["a.png"], zoteroKey: "NEWKEY" });
  assert.equal(saved[0]!.title, "Attention Is All You Need");
});

test("a provider that declines the paper is a failure, not a crash", async () => {
  // The provider returns nothing for a paper it cannot identify; that is not an
  // error to throw, but it is not a success either.
  const { useCase, saved } = harness({ key: undefined });

  const outcome = await useCase.execute(paper());

  assert.equal(outcome, "failed");
  assert.deepEqual(saved, [], "nothing to store without a key");
});

test("a push that throws is reported rather than escaping", async () => {
  // This is the divergence, and the reason the outcome exists: the facade's copy
  // swallowed it and the composition root's copy let it escape the executor it
  // was called from — where the paper had already been added, so the caller was
  // told the whole proposal failed when only the push had.
  const { useCase, saved } = harness({ throws: true });

  const outcome = await useCase.execute(paper());

  assert.equal(outcome, "failed");
  assert.deepEqual(saved, []);
});
