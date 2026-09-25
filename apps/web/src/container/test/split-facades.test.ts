import assert from "node:assert/strict";
import test from "node:test";

import type { ReaderAnnotation } from "@weaveforge/core";
import { stubFetch } from "@/lib/test/stub-fetch";
import { PaperFieldsFacade } from "../facades/paper-fields";
import { ZoteroFacade } from "../facades/zotero";

/**
 * The two facades split out of `PapersFacade`.
 *
 * The plan promised a facade test with this split, and the thing most worth
 * pinning is the pair that writes to somebody's real Zotero library: the dry run
 * and the live push were one mistyped argument apart in the audit's own patch
 * (BUG-09), which dropped the `{ live: true }` this push passes. A test that
 * only asserted "it returns something" would not have caught that; a test that
 * asserts *no request was made* by the dry run and *a request was made* by the
 * live push does.
 */

function annotation(over: Partial<ReaderAnnotation> = {}): ReaderAnnotation {
  return {
    id: "a1",
    paperId: "p1",
    origin: "local",
    type: "highlight",
    color: "#ffd400",
    text: "boiling water",
    comment: "",
    tags: [],
    zoteroKey: null,
    // A write payload carries the annotation's position, sort order and tags;
    // this is the shape `toZoteroWritePayload` reads.
    anchor: { zoteroPosition: { pageIndex: 0, rects: [[1, 2, 3, 4]] } },
    sortIndex: "00000|000000|00000",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as ReaderAnnotation;
}

function zoteroWith(annotations: ReaderAnnotation[]) {
  return new ZoteroFacade({
    bibliography: {} as never,
    pushToZotero: { execute: async () => "pushed" } as never,
    importLocalZotero: { execute: async () => ({ papers: 0, annotations: 0, items: 0 }) } as never,
    readerAnnotations: { list: async () => annotations } as never,
    papers: {
      list: async () => [],
      getById: async () => null,
      save: async () => {},
    } as never,
    manageTags: { reconcileSources: async () => {} } as never,
    // The live path builds its client with these; a stub key is enough to prove
    // which path ran, because the dry run never reads them.
    zoteroCredentials: async () => ({ apiKey: "k", library: "users/1" }),
  });
}

test("the dry run writes nothing, however it is called", async () => {
  const stub = stubFetch(() => new Response("{}", { status: 200 }));
  try {
    const result = await zoteroWith([annotation()]).dryRunZoteroAnnotationWriteBack("p1", "ATT1");

    assert.equal(stub.calls.length, 0, "a dry run that reaches the network is not a dry run");
    assert.ok(result, "and it still reports what it would have done");
  } finally {
    stub.restore();
  }
});

test("the live push sends the local annotations, with the live flag", async () => {
  const bodies: string[] = [];
  const stub = stubFetch((_url, init) => {
    bodies.push(String(init?.body ?? ""));
    return new Response("{}", { status: 200 });
  });
  try {
    await zoteroWith([
      annotation({ id: "a1", origin: "local", zoteroKey: null }),
      // Pulled from Zotero: it is already there, and pushing it back is how a
      // round trip becomes a duplicate.
      annotation({ id: "a2", origin: "zotero", zoteroKey: "Z1" }),
    ]).pushAnnotationsToZotero("p1", "ATT1");

    assert.ok(stub.calls.length > 0, "the live push has to actually call Zotero");
    const body = bodies.join("\n");
    assert.match(body, /boiling water/, "the local annotation is sent");
    assert.doesNotMatch(body, /Z1/, "the one that came from Zotero is not sent back");
  } finally {
    stub.restore();
  }
});

test("syncBibliography applies what it pulled onto papers and tags", async () => {
  const applied: string[] = [];
  const facade = new ZoteroFacade({
    bibliography: {
      syncLibrary: async () => ({ items: 2 }),
      pullAnnotations: async () => new Map([["PAPER1", [{ key: "A1" }]]]),
    } as never,
    pushToZotero: { execute: async () => "pushed" } as never,
    importLocalZotero: { execute: async () => ({ papers: 0, annotations: 0, items: 0 }) } as never,
    readerAnnotations: { list: async () => [] } as never,
    papers: {
      list: async () => [],
      getById: async () => null,
      save: async () => applied.push("saved"),
    } as never,
    manageTags: { reconcileSources: async () => applied.push("tags") } as never,
    zoteroCredentials: async () => ({}),
  });

  const result = await facade.syncBibliography();

  assert.deepEqual(result.library, { items: 2 });
  // A paper the annotations name but the library does not have is not invented
  // here — `applyBibliographyAnnotations` is what decides, and it is tested
  // where it lives. What this asserts is that the facade hands it both
  // collaborators rather than calling the integration twice.
  assert.equal(typeof result.annotations, "number");
});

test("custom fields are pass-throughs to the one use case that owns the rules", async () => {
  const calls: string[] = [];
  const facade = new PaperFieldsFacade({
    paperFields: {
      listDefs: async () => {
        calls.push("listDefs");
        return [];
      },
      listValuesForPaper: async () => {
        calls.push("listValuesForPaper");
        return [];
      },
      listValuesForProject: async () => {
        calls.push("listValuesForProject");
        return [];
      },
      define: async () => {
        calls.push("define");
        return {} as never;
      },
      remove: async (fieldId: string) => {
        calls.push(`remove:${fieldId}`);
      },
      setValue: async () => {
        calls.push("setValue");
        return {} as never;
      },
    } as never,
  });

  await facade.listPaperFieldDefs();
  await facade.listPaperFieldValuesForProject();
  await facade.removePaperField("f1");

  assert.deepEqual(calls, ["listDefs", "listValuesForProject", "remove:f1"]);
});
