import assert from "node:assert/strict";
import { test } from "node:test";
import { addsKeysOnly, mergeAddedKeys } from "../domain/add-keys-only";

test("added frontmatter keys with the same body and keys are an add-keys merge", () => {
  assert.equal(addsKeysOnly("---\nid: a\n---\nbody", "---\nid: a\norder: 0\n---\nbody"), true);
});

test("a key's quote style does not count as a change: to_read and \"to_read\" are the same value", () => {
  const prev = "---\nweaveforge-id: fd0c\nstatus: to_read\n---\nbody";
  const next = '---\nweaveforge-id: "fd0c"\nwf: 3\nstatus: "to_read"\n---\nbody';
  assert.equal(addsKeysOnly(prev, next), true);
});

test("a list's spacing and quoting are not changes: [a, b], [\"a\", \"b\"] and [\"a\",\"b\"] are the same list", () => {
  const prev = '---\ntags: [g-causal, paper-iii]\nauthors: ["Y. Bengio", "T. Deleu"]\nyear: 2020\n---\nb';
  const next = '---\ntags: ["g-causal","paper-iii"]\nauthors: ["Y. Bengio","T. Deleu"]\nyear: "2020"\n---\nb';
  assert.equal(addsKeysOnly(prev, next), true);
  assert.equal(addsKeysOnly("---\ntags: []\n---\nb", '---\ntags: []\n---\nb'), true);
});

test("a list with an item changed, added or reordered is a change", () => {
  assert.equal(addsKeysOnly("---\ntags: [a, b]\n---\nb", '---\ntags: ["a","c"]\n---\nb'), false);
  assert.equal(addsKeysOnly("---\ntags: [a, b]\n---\nb", '---\ntags: ["a","b","c"]\n---\nb'), false);
  assert.equal(addsKeysOnly("---\ntags: [a, b]\n---\nb", '---\ntags: ["b","a"]\n---\nb'), false);
});

test("a changed value is never an add-keys merge, quoted or not", () => {
  assert.equal(addsKeysOnly("---\nstatus: to_read\n---\nb", '---\nstatus: "read"\n---\nb'), false);
  assert.equal(addsKeysOnly('---\nstatus: "a b"\n---\nb', "---\nstatus: a  b\n---\nb"), false);
});

test("a body differing only by its final newline is the same body; any other body edit is not", () => {
  assert.equal(addsKeysOnly("---\nid: a\n---\nbody", "---\nid: a\n---\nbody\n"), true);
  assert.equal(addsKeysOnly("---\nid: a\n---\nbody", "---\nid: a\n---\nbody!\n"), false);
  assert.equal(addsKeysOnly("---\nid: a\n---\nline\n\nmore", "---\nid: a\n---\nline\nmore"), false);
});

test("a removed key is never an add-keys merge", () => {
  assert.equal(addsKeysOnly("---\nid: a\nx: 1\n---\nb", "---\nid: a\n---\nb"), false);
});

test("JSON: added keys at any depth are an add-keys merge; a changed or removed value is not", () => {
  const prev = '{\n  "tags": {\n    "a": {}\n  }\n}';
  assert.equal(addsKeysOnly(prev, '{"tags":{"a":{},"b":{}}}'), true);
  assert.equal(addsKeysOnly(prev, '{"tags":{"a":{"color":"red"}},"x":1}'), true);
  assert.equal(addsKeysOnly(prev, '{"tags":{}}'), false);
  assert.equal(addsKeysOnly('{"a":[1,2]}', '{"a":[1,2,3]}'), false);
  assert.equal(addsKeysOnly('{"a":1}', '{"a":"1"}'), false);
  assert.equal(addsKeysOnly('{"a":1}', "not json"), false);
});

test("tags with spaces and the same tags hyphenated are the same tags; other keys keep their spaces", () => {
  assert.equal(addsKeysOnly("---\ntags: [a-b---c]\n---\nb", '---\ntags: ["a b - c"]\n---\nb'), true);
  assert.equal(addsKeysOnly("---\ntags: [a-b]\n---\nb", '---\ntags: ["a c"]\n---\nb'), false);
  assert.equal(addsKeysOnly("---\ntitle: a-b\n---\nb", '---\ntitle: "a b"\n---\nb'), false);
});

test("mergeAddedKeys keeps the file's lines and keys, adds the new keys, and refuses a changed value or body", () => {
  assert.equal(mergeAddedKeys("---\nid: a\nx: 1\n---\nb", '---\nid: "a"\ny: 2\n---\nb\n'), "---\nid: a\nx: 1\ny: 2\n---\nb");
  assert.equal(mergeAddedKeys("---\nid: a\n---\nb", '---\nid: "a"\n---\nb'), "---\nid: a\n---\nb");
  assert.equal(mergeAddedKeys("---\nid: a\n---\nb", "---\nid: c\n---\nb"), null);
  assert.equal(mergeAddedKeys("---\nid: a\n---\nb", "---\nid: a\n---\nb!"), null);
  assert.equal(mergeAddedKeys('{"a":1}', '{"a":1,"b":2}'), '{"a":1,"b":2}');
  assert.equal(mergeAddedKeys('{"a":1}', '{"b":2}'), null);
});

test("a file saved after the DB row keeps its own values; an older or undated file does not", () => {
  const file = '---\nstatus: read\nupdated-at: "2026-11-24T00:29:08.576Z"\n---\nb';
  const db = '---\nstatus: "to_read"\nupdated-at: "2026-11-23T14:04:56.773Z"\nabstract: "x"\n---\nb';
  assert.equal(mergeAddedKeys(file, db), '---\nstatus: read\nupdated-at: "2026-11-24T00:29:08.576Z"\nabstract: "x"\n---\nb');
  assert.equal(mergeAddedKeys(file.replace("11-24", "11-22"), db), null);
  assert.equal(mergeAddedKeys("---\nstatus: read\n---\nb", db), null);
  assert.equal(mergeAddedKeys(file.replace("updated-at", "x"), db), null);
  assert.equal(mergeAddedKeys(file, db.replace("---\nb", "---\nb!")), null);
});

/** The 0.9.7 copy-data ink notes: the file has legacy ink (a sidecar), the DB version adds the ink header and page markers. */
test("a DB version that only adds ink to the body takes its body and later updated-at, keeping the file's keys", () => {
  const file = '---\nweaveforge-id: a\nupdated-at: "2026-11-20T00:00:00.000Z"\n---\ntext\n';
  const ink = "<!-- weaveforge-ink ink-pages=1 ink-page-order=p1 -->";
  const db = `---\nweaveforge-id: "a"\nupdated-at: "2026-11-21T00:00:00.000Z"\norder: 0\n---\n${ink}\ntext\n\n<!-- page 1 -->\n`;
  assert.equal(
    mergeAddedKeys(file, db),
    `---\nweaveforge-id: a\nupdated-at: "2026-11-21T00:00:00.000Z"\norder: 0\n---\n${ink}\ntext\n\n<!-- page 1 -->\n`,
  );
  // A newer file keeps its own updated-at; the ink still lands.
  const newer = file.replace("11-20", "11-25");
  assert.equal(mergeAddedKeys(newer, db), `---\nweaveforge-id: a\nupdated-at: "2026-11-25T00:00:00.000Z"\norder: 0\n---\n${ink}\ntext\n\n<!-- page 1 -->\n`);
  // Ink plus a text edit, or a file that already has an ink header, is not an ink-only add.
  assert.equal(mergeAddedKeys(file, db.replace("text", "text!")), null);
  assert.equal(mergeAddedKeys(`---\nweaveforge-id: a\n---\n${ink}\ntext\n`, db), null);
  // Other changed keys still refuse.
  assert.equal(mergeAddedKeys(file.replace("---\ntext", "status: read\n---\ntext"), db.replace("order: 0", "status: to_read")), null);
});
