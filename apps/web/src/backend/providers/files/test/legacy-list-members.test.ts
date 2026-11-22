import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { IWorkspaceFs } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { readMemberFields } from "../member-frontmatter";
import { migrateLegacyLists } from "../legacy-list-members";
import { FileReadingListItemRepository } from "../file-reading-list-repo";

before(loadTestCore);

const ROOT = "thesis";
const P1 = `${ROOT}/papers/paper-one.paper.md`;
const P2 = `${ROOT}/papers/paper-two.paper.md`;
const LIST = `${ROOT}/reading-lists/review--l1.list.md`;
const LINK = "[[review--l1.list]]";

/** A 0.9.6 list file: members as links, member-notes keyed by kind:id. */
function oldListFile(): string {
  return [
    "---",
    'weaveforge-id: "l1"',
    'weaveforge-type: "reading_list"',
    'title: "Review"',
    'created-at: "2026-06-24T00:00:00.000Z"',
    'members: ["[[paper-one.paper]]", "[[Ghost.paper]]"]',
    'member-notes: {"paper:p1": {"id": "i1", "order": 1, "note": "key"}}',
    "---",
    "",
  ].join("\n");
}

async function setup() {
  const fs = new MemoryWorkspaceFs();
  const core = typedCore();
  await fs.writeFile(P1, core.writePaperRow(null, { id: "p1", title: "Paper one" }));
  await fs.writeFile(P2, core.writePaperRow(null, { id: "p2", title: "Paper two" }));
  await fs.writeFile(LIST, oldListFile());
  return fs;
}

/** A filesystem whose rename fails: the list file's .part is written, the swap never happens. */
function crashOnRename(fs: IWorkspaceFs): IWorkspaceFs {
  return new Proxy(fs, {
    get(target, key) {
      if (key === "rename") return async () => { throw new Error("crash between the two writes"); };
      const v = Reflect.get(target, key, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

test("an old list file is rewritten: members move to their frontmatter, the list file keeps none", async () => {
  const fs = await setup();
  await migrateLegacyLists(fs, () => ROOT);
  assert.deepEqual(readMemberFields(await fs.readText(P1)), { lists: [LINK], listNotes: { [LINK]: "key" } });
  const listText = await fs.readText(LIST);
  assert.doesNotMatch(listText, /paper-one/);
  assert.doesNotMatch(listText, /^member-notes:/m);
  const items = await new FileReadingListItemRepository(fs, () => ROOT).listItems("l1");
  assert.deepEqual(items.map((i) => i.id), ["l1:p1"]);
});

test("an unresolved member stays in the list file, with its note", async () => {
  const fs = await setup();
  await migrateLegacyLists(fs, () => ROOT);
  const text = await fs.readText(LIST);
  assert.match(text, /^members: \["\[\[Ghost\.paper\]\]"\]$/m);
});

test("a second run changes nothing and adds no duplicate membership", async () => {
  const fs = await setup();
  await migrateLegacyLists(fs, () => ROOT);
  const once = [await fs.readText(P1), await fs.readText(LIST)];
  await migrateLegacyLists(fs, () => ROOT);
  assert.deepEqual([await fs.readText(P1), await fs.readText(LIST)], once);
  assert.deepEqual(readMemberFields(await fs.readText(P1)).lists, [LINK]);
});

test("a crash between the member writes and the list rewrite leaves both sides readable; a re-run completes", async () => {
  const fs = await setup();
  await assert.rejects(migrateLegacyLists(crashOnRename(fs), () => ROOT), /crash/);
  // Members already carry the membership; the list file still has its old keys and stays readable.
  assert.deepEqual(readMemberFields(await fs.readText(P1)).lists, [LINK]);
  assert.match(await fs.readText(LIST), /^members:/m);
  const beforeRerun = await new FileReadingListItemRepository(fs, () => ROOT).listItems("l1");
  assert.deepEqual(beforeRerun.map((i) => i.id), ["l1:p1"]);
  await migrateLegacyLists(fs, () => ROOT);
  assert.deepEqual(readMemberFields(await fs.readText(P1)), { lists: [LINK], listNotes: { [LINK]: "key" } });
  assert.doesNotMatch(await fs.readText(LIST), /^members: \["\[\[paper-one/m);
  assert.deepEqual(
    (await new FileReadingListItemRepository(fs, () => ROOT).listItems("l1")).map((i) => i.id),
    ["l1:p1"],
  );
});
