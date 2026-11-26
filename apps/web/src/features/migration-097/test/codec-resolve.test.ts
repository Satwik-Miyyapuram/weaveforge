import assert from "node:assert/strict";
import { test } from "node:test";
import { codecResolver } from "../domain/codec-resolve";
import type { FileCodec, Row } from "../domain/ports";

// A file is `id|title` then the body; toFileOver writes the row's title but keeps the file's body,
// as the real codec keeps what it does not own.
const parse = (text: string): Row => {
  const [head = "", ...body] = text.split("\n");
  const [id, title] = head.split("|");
  return { id, title, notes: body.join("\n") };
};
const codec: FileCodec = {
  supports: () => true,
  toFile: (_kind, row) => ({ path: "s.md", text: `${String(row.id)}|${String(row.title)}\n${String(row.notes)}` }),
  toRow: (_kind, _path, text) => parse(text),
  toFileOver: (_kind, fileText, row) => `${String(row.id)}|${String(row.title)}\n${parse(fileText).notes as string}`,
};

test("resolver: a file whose values all match the DB row takes the DB's layout", () => {
  const resolve = codecResolver(codec, "reportSections", "s.md", { id: "a", title: "T", notes: "body" })!;
  assert.equal(resolve("a|T\nbody"), "a|T\nbody");
});

test("resolver: a body that differs from the DB row is not merged in place (the DB version goes to a copy)", () => {
  const resolve = codecResolver(codec, "reportSections", "s.md", { id: "a", title: "T", notes: "db body" })!;
  assert.equal(resolve("a|T\nuser body"), null);
});
