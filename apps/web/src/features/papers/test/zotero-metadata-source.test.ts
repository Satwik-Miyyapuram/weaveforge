import { test } from "node:test";
import assert from "node:assert/strict";
import { ZoteroMetadataSource } from "../infrastructure/zotero-metadata-source";

const PAPER = {
  key: "PAPER1",
  itemType: "journalArticle",
  title: "Recalling shared memories in an embodied conversational agent",
  DOI: "10.1234/abc",
  creators: [{ firstName: "Ada", lastName: "Lovelace" }],
};
const ATTACHMENT = {
  key: "ATT1",
  itemType: "attachment",
  parentItem: "PAPER1",
  title: "SAGE PDF Full Text",
};

function source(items: Record<string, unknown>) {
  const requested: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const key = url.split("/items/")[1] ?? "";
    const data = items[key];
    if (!data) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as unknown as typeof fetch;
  return {
    requested,
    src: new ZoteroMetadataSource(async () => ({ apiKey: "k", library: "users/1" }), fetchFn),
  };
}

test("zotero import: an attachment key resolves to its parent paper", async () => {
  const { src, requested } = source({ PAPER1: PAPER, ATT1: ATTACHMENT });

  const meta = await src.fetch({ kind: "zotero", value: "ATT1" });

  assert.equal(meta.title, PAPER.title);
  assert.equal(meta.doi, "10.1234/abc");
  assert.deepEqual(meta.authors, ["Ada Lovelace"]);
  assert.ok(requested.some((u) => u.endsWith("/items/PAPER1")), "the parent was never read");
});

test("zotero import: a standalone attachment is refused, not imported nameless", async () => {
  const standalone = { key: "ATT2", itemType: "attachment", title: "ScienceDirect Full Text PDF" };
  const { src } = source({ ATT2: standalone });

  await assert.rejects(
    () => src.fetch({ kind: "zotero", value: "ATT2" }),
    /no parent entry/,
  );
});

test("zotero import: a normal item is read in one request", async () => {
  const { src, requested } = source({ PAPER1: PAPER });

  const meta = await src.fetch({ kind: "zotero", value: "PAPER1" });

  assert.equal(meta.title, PAPER.title);
  assert.equal(requested.length, 1);
});
