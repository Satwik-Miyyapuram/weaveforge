import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryReaderAnnotationRepository } from "../src/testing/in-memory-reader-annotation-repository.js";

test("InMemoryReaderAnnotationRepository creates, lists, updates, removes", async () => {
  const repo = new InMemoryReaderAnnotationRepository();
  const created = await repo.create("paper-1", {
    type: "highlight",
    color: "#ffd400",
    text: "hello",
    pageIndex: 0,
    anchor: {
      locus: { quote: { type: "TextQuoteSelector", exact: "hello" } },
      zoteroPosition: { pageIndex: 0, rects: [[1, 2, 3, 4]] },
    },
  });
  assert.equal(created.origin, "local");
  assert.equal(created.zoteroKey, null);
  assert.equal(created.syncState, "local");
  assert.deepEqual(await repo.list("paper-1"), [created]);
  assert.deepEqual(await repo.list("other"), []);

  const updated = await repo.update(created.id, { comment: "note" });
  assert.equal(updated.comment, "note");
  assert.notEqual(updated.updatedAt, created.updatedAt);

  await repo.remove(created.id);
  assert.deepEqual(await repo.list("paper-1"), []);
});

test("InMemoryReaderAnnotationRepository sorts by sortIndex and preserves tags", async () => {
  const repo = new InMemoryReaderAnnotationRepository();
  const later = await repo.create("p", {
    type: "underline",
    color: "#2ea8e5",
    pageIndex: 1,
    sortIndex: "00001|000000|00000",
    tags: ["a", "b"],
    anchor: { zoteroPosition: { pageIndex: 1, rects: [[0, 0, 1, 1]] } },
  });
  const earlier = await repo.create("p", {
    type: "note",
    color: "#ff6666",
    pageIndex: 0,
    sortIndex: "00000|000010|00000",
    comment: "sticky",
    anchor: { zoteroPosition: { pageIndex: 0, rects: [[0, 0, 10, 10]] } },
  });
  const listed = await repo.list("p");
  assert.deepEqual(
    listed.map((a) => a.id),
    [earlier.id, later.id],
  );
  assert.deepEqual(later.tags, ["a", "b"]);
  assert.equal(earlier.comment, "sticky");
});

test("InMemoryReaderAnnotationRepository update replaces tags and color", async () => {
  const repo = new InMemoryReaderAnnotationRepository();
  const created = await repo.create("p", {
    type: "text",
    color: "#aaaaaa",
    pageIndex: 0,
    text: "box",
    anchor: { zoteroPosition: { pageIndex: 0, rects: [[1, 2, 3, 4]] } },
  });
  const updated = await repo.update(created.id, {
    color: "  #5fb236 ",
    tags: ["methods"],
    text: " updated ",
  });
  assert.equal(updated.color, "#5fb236");
  assert.deepEqual(updated.tags, ["methods"]);
  assert.equal(updated.text, "updated");
});

test("InMemoryReaderAnnotationRepository rejects unknown types", async () => {
  const repo = new InMemoryReaderAnnotationRepository();
  await assert.rejects(
    () =>
      repo.create("p", {
        type: "strikeout" as never,
        color: "#000",
        pageIndex: 0,
        anchor: {},
      }),
    /Invalid annotation type/,
  );
});
