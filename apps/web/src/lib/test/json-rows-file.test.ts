import { test } from "node:test";
import assert from "node:assert/strict";
import { ConflictError } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { changeJsonRows, parseJsonRows, readJsonRows, renderJsonRows } from "../json-rows-file";

const FILE = "thesis/.weaveforge/rows.json";

class RacingFs extends MemoryWorkspaceFs {
  races: Array<() => Promise<void>> = [];

  override async writeTextIf(path: string, text: string, expected: string | null): Promise<boolean> {
    const race = this.races.shift();
    if (race) await race();
    return super.writeTextIf(path, text, expected);
  }
}

test("blank text is no rows; rows render as indented JSON with one newline", () => {
  assert.deepEqual(parseJsonRows("", FILE), []);
  assert.deepEqual(parseJsonRows("  \n", FILE), []);
  const rows = [{ id: "a", n: 1 }];
  const text = renderJsonRows(rows);
  assert.equal(text, '[\n  {\n    "id": "a",\n    "n": 1\n  }\n]\n');
  assert.deepEqual(parseJsonRows(text, FILE), rows);
});

test("text that is not an array of objects is refused and never written over", async () => {
  for (const text of ["{}", "[1]", "[[]]", "[null]", '"x"']) {
    assert.throws(() => parseJsonRows(text, FILE), /not a JSON array of objects/);
  }
  const fs = new MemoryWorkspaceFs();
  await fs.mkdirp("thesis/.weaveforge");
  await fs.writeFile(FILE, "{}");
  await assert.rejects(changeJsonRows(fs, FILE, () => [{ id: "x" }]));
  assert.equal(await fs.readText(FILE), "{}");
});

test("a missing file reads as no rows and an empty change creates nothing", async () => {
  const fs = new MemoryWorkspaceFs();
  assert.deepEqual(await readJsonRows(fs, FILE), { text: null, rows: [] });
  assert.deepEqual(await changeJsonRows(fs, FILE, (rows) => rows), []);
  assert.equal(await fs.stat(FILE), null);
});

test("a change creates the folder and file, and a later change edits it", async () => {
  const fs = new MemoryWorkspaceFs();
  await changeJsonRows(fs, FILE, (rows) => [...rows, { id: "a" }]);
  await changeJsonRows(fs, FILE, (rows) => [...rows, { id: "b" }]);
  assert.deepEqual((await readJsonRows(fs, FILE)).rows, [{ id: "a" }, { id: "b" }]);
});

test("a row added outside the app between read and write is kept", async () => {
  const fs = new RacingFs();
  await changeJsonRows(fs, FILE, () => [{ id: "a" }]);
  fs.races.push(async () => fs.writeFile(FILE, renderJsonRows([{ id: "a" }, { id: "outside" }])));
  await changeJsonRows(fs, FILE, (rows) => [...rows, { id: "b" }]);
  assert.deepEqual((await readJsonRows(fs, FILE)).rows, [{ id: "a" }, { id: "outside" }, { id: "b" }]);
});

test("a file that keeps changing gives a ConflictError and loses no outside row", async () => {
  const fs = new RacingFs();
  await changeJsonRows(fs, FILE, () => [{ id: "a" }]);
  for (let n = 0; n < 5; n += 1) {
    fs.races.push(async () => {
      const { rows } = await readJsonRows(fs, FILE);
      await fs.writeFile(FILE, renderJsonRows([...rows, { id: `outside-${n}` }]));
    });
  }
  await assert.rejects(changeJsonRows(fs, FILE, (rows) => [...rows, { id: "b" }]), ConflictError);
  const ids = (await readJsonRows(fs, FILE)).rows.map((row) => row.id);
  assert.deepEqual(ids, ["a", "outside-0", "outside-1", "outside-2", "outside-3", "outside-4"]);
});

test("a workspace without a conditional write is refused", async () => {
  const fs = new MemoryWorkspaceFs();
  Object.defineProperty(fs, "writeTextIf", { value: undefined });
  await assert.rejects(changeJsonRows(fs, FILE, () => [{ id: "a" }]), /no conditional write/);
  assert.equal(await fs.stat(FILE), null);
});
