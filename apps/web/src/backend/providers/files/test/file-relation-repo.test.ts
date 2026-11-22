import { before, test } from "node:test";
import assert from "node:assert/strict";
import { NotFoundError, type PaperRelation } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FilePaperRelationRepository } from "../file-relation-repo";

before(loadTestCore);

const ROOT = "thesis";
const A = `${ROOT}/papers/ünïcode a.paper.md`;

async function setup() {
  const fs = new MemoryWorkspaceFs();
  const core = typedCore();
  await fs.writeFile(A, core.writePaperRow(null, { id: "a", title: "Ünïcode A" }) + "Body stays.\n");
  await fs.writeFile(`${ROOT}/papers/b.paper.md`, core.writePaperRow(null, { id: "b", title: "B" }));
  await fs.writeFile(`${ROOT}/papers/b-2.paper.md`, core.writePaperRow(null, { id: "b2", title: "B" }));
  const papers = new FilePaperRepository(fs, ROOT);
  return { fs, papers, edges: new FilePaperRelationRepository(papers, fs, () => ROOT) };
}

function edge(over: Partial<PaperRelation> & Pick<PaperRelation, "fromPaper" | "toPaper">): PaperRelation {
  return { id: crypto.randomUUID(), relation: "cites", source: "manual", createdAt: "2026-06-24T00:00:00.000Z", ...over };
}

test("T4: an edge round-trips through the source paper's file, naming its target by link", async () => {
  const { fs, edges } = await setup();
  const e = edge({ fromPaper: "a", toPaper: "b2", note: "Key «note»", source: "auto" });
  await edges.save(e);
  assert.deepEqual(await edges.getById(e.id), e);
  const text = await fs.readText(A);
  assert.match(text, /relations: \[\{"to":"\[\[b-2\.paper\]\]","type":"cites"/);
  assert.doesNotMatch(text, /"b2"/);
  assert.match(text, /Body stays\.\n$/);
  assert.equal(await edges.getById("nope"), null);
});

test("findEdge, list filters, relationsFor and getGraph", async () => {
  const { edges } = await setup();
  const ab = edge({ fromPaper: "a", toPaper: "b" });
  const ba = edge({ fromPaper: "b", toPaper: "a", relation: "extends" });
  const bb2 = edge({ fromPaper: "b", toPaper: "b2", relation: "similar" });
  for (const e of [ab, ba, bb2]) await edges.save(e);
  assert.equal((await edges.findEdge("a", "b", "cites"))?.id, ab.id);
  assert.equal(await edges.findEdge("b", "a", "cites"), null);
  assert.equal(await edges.findEdge("a", "b", "extends"), null);
  assert.deepEqual((await edges.list({ fromPaper: "b" })).map((e) => e.id).sort(), [ba.id, bb2.id].sort());
  assert.deepEqual((await edges.list({ toPaper: "a" })).map((e) => e.id), [ba.id]);
  assert.deepEqual((await edges.list({ relation: "similar" })).map((e) => e.id), [bb2.id]);
  assert.deepEqual((await edges.relationsFor("a")).map((e) => e.id).sort(), [ab.id, ba.id].sort());
  assert.equal((await edges.getGraph()).length, 3);
});

test("save upserts by id and by (from, to, type); moving the source moves the edge; delete removes it", async () => {
  const { edges } = await setup();
  const e = edge({ fromPaper: "a", toPaper: "b" });
  await edges.save(e);
  await edges.save({ ...e, note: "edited" });
  await edges.save(edge({ id: "other", fromPaper: "a", toPaper: "b" }));
  assert.deepEqual((await edges.getGraph()).map((r) => [r.id, r.note]), [["other", undefined]]);
  await edges.save(edge({ id: "other", fromPaper: "b", toPaper: "a" }));
  assert.deepEqual((await edges.getGraph()).map((r) => [r.id, r.fromPaper]), [["other", "b"]]);
  await edges.delete("other");
  assert.deepEqual(await edges.getGraph(), []);
  await edges.delete("nope");
});

test("save refuses a missing source or target paper", async () => {
  const { edges } = await setup();
  await assert.rejects(edges.save(edge({ fromPaper: "missing", toPaper: "b" })), NotFoundError);
  await assert.rejects(edges.save(edge({ fromPaper: "a", toPaper: "missing" })), NotFoundError);
});

test("hand-typed edges read; unknown types and dangling links stay in the file unlisted", async () => {
  const { fs, edges } = await setup();
  const text = (await fs.readText(A)).replace(
    /^---\n/,
    '---\nrelations: [{"to":"[[B-2.paper|alias]]","type":"cites"},{"to":"b","type":"extends"},{"to":"[[Gone]]","type":"cites"},{"to":"[[b.paper]]","type":"inspired"}]\n',
  );
  await fs.writeFile(A, text);
  assert.deepEqual(await edges.relationsFor("a"), [
    { id: "a:cites:b2", fromPaper: "a", toPaper: "b2", relation: "cites", source: "manual", createdAt: "" },
    { id: "a:extends:b", fromPaper: "a", toPaper: "b", relation: "extends", source: "manual", createdAt: "" },
  ]);
  await edges.delete("a:cites:b2");
  const after = await fs.readText(A);
  assert.match(after, /Gone/);
  assert.match(after, /inspired/);
  assert.doesNotMatch(after, /B-2/);
  assert.deepEqual((await edges.relationsFor("a")).map((e) => e.id), ["a:extends:b"]);
});

test("an empty folder has no edges", async () => {
  const fs = new MemoryWorkspaceFs();
  const edges = new FilePaperRelationRepository(new FilePaperRepository(fs, ROOT), fs, () => ROOT);
  assert.deepEqual(await edges.getGraph(), []);
});
