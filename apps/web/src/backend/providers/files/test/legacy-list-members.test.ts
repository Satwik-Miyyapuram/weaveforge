import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { IWorkspaceFs } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { readMemberFields } from "../member-frontmatter";
import { migrateLegacyLists } from "../legacy-list-members";
import { FileReadingListItemRepository } from "../file-reading-list-repo";
import type { AppLogInput } from "@/lib/error-report/app-log";
import { LinkIndex } from "../link-index";

before(loadTestCore);

/** A filesystem that counts the reads of one path. */
function countingReads(fs: IWorkspaceFs, path: string): { fs: IWorkspaceFs; reads: () => number } {
  let reads = 0;
  const counted = new Proxy(fs, {
    get(target, key) {
      if (key === "readText") {
        return async (p: string) => {
          if (p === path) reads += 1;
          return target.readText(p);
        };
      }
      const v = Reflect.get(target, key, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { fs: counted, reads: () => reads };
}

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

/** A filesystem whose write of the list file fails: the members are written, the list file is not. */
function crashOnListWrite(fs: IWorkspaceFs): IWorkspaceFs {
  return new Proxy(fs, {
    get(target, key) {
      if (key === "writeTextIf") {
        return async (path: string, text: string, expected: string | null) => {
          if (path === LIST) throw new Error("crash between the two writes");
          return target.writeTextIf!(path, text, expected);
        };
      }
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
  const repo = new FileReadingListItemRepository(fs, () => ROOT);
  assert.deepEqual((await repo.listItems("l1")).map((i) => i.id), ["l1:p1"]);
  assert.deepEqual((await repo.legacyLeftovers("l1")).map((l) => l.legacyLink), ["[[Ghost.paper]]"]);
});

test("a duplicate legacy link gives one leftover and no duplicate item id", async () => {
  const fs = await setup();
  await fs.writeFile(
    LIST,
    oldListFile().replace(
      'members: ["[[paper-one.paper]]", "[[Ghost.paper]]"]',
      'members: ["[[paper-one.paper]]", "[[paper-one.paper]]", "[[Ghost.paper]]", "[[Ghost.paper]]"]',
    ),
  );
  await fs.writeFile(P1, (await fs.readText(P1)).replace("---\n", `---\nlists: ["${LINK}", "${LINK}"]\n`));
  const repo = new FileReadingListItemRepository(fs, () => ROOT);
  const ids = (await repo.listItems("l1")).map((i) => i.id);
  assert.deepEqual(ids, ["l1:p1"]);
  const leftovers = await repo.legacyLeftovers("l1");
  assert.deepEqual(leftovers.map((l) => l.legacyLink), ["[[Ghost.paper]]"]);
});

test("listItems never returns an item without a paper or note; a legacy leftover is only in legacyLeftovers", async () => {
  const fs = await setup();
  await migrateLegacyLists(fs, () => ROOT, () => {});
  const items = await new FileReadingListItemRepository(fs, () => ROOT).listItems("l1");
  assert.ok(items.length > 0);
  assert.ok(items.every((i) => i.paperId !== undefined || i.vaultPageId !== undefined));
});

test("a resolved member the migration could not move is a pending leftover, not dropped", async () => {
  const fs = await setup();
  // P2 is first in the list and its lists value is broken: the rewrite stops before P1 moves.
  await fs.writeFile(LIST, oldListFile().replace('members: ["[[paper-one.paper]]", "[[Ghost.paper]]"]', 'members: ["[[paper-two.paper]]", "[[paper-one.paper]]"]'));
  await fs.writeFile(P2, (await fs.readText(P2)).replace("---\n", "---\nlists: [oops\n"));
  await migrateLegacyLists(fs, () => ROOT, () => {});
  const leftovers = await new FileReadingListItemRepository(fs, () => ROOT).legacyLeftovers("l1");
  assert.ok(leftovers.some((l) => l.state === "pending" && l.paperId === "p1" && l.note === "key"));
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
  await migrateLegacyLists(crashOnListWrite(fs), () => ROOT);
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

test("a list-note already on the member is kept; a conflicting legacy note is not written over it", async () => {
  const fs = await setup();
  const p1 = await fs.readText(P1);
  await fs.writeFile(P1, p1.replace("---\n", `---\nlists: ["${LINK}"]\nlist-notes: {"${LINK}": "mine"}\n`));
  await migrateLegacyLists(fs, () => ROOT);
  assert.equal(readMemberFields(await fs.readText(P1)).listNotes[LINK], "mine");
  // The conflicting member stays in the list file with its legacy note: nothing is dropped.
  const listText = await fs.readText(LIST);
  assert.match(listText, /paper-one/);
  assert.match(listText, /"paper:p1"/);
});

test("a conflicting leftover is listed as conflict with the paper's note; an unresolved one is listed as unresolved", async () => {
  const fs = await setup();
  const p1 = await fs.readText(P1);
  await fs.writeFile(P1, p1.replace("---\n", `---\nlists: ["${LINK}"]\nlist-notes: {"${LINK}": "mine"}\n`));
  await migrateLegacyLists(fs, () => ROOT);
  const repo = new FileReadingListItemRepository(fs, () => ROOT);
  const item = (await repo.listItems("l1")).find((i) => i.id === "l1:p1");
  assert.equal(item?.note, "mine");
  const leftovers = await repo.legacyLeftovers("l1");
  const conflict = leftovers.find((l) => l.state === "conflict");
  assert.equal(conflict?.paperId, "p1");
  assert.equal(conflict?.note, "key");
  const unresolved = leftovers.find((l) => l.state === "unresolved");
  assert.equal(unresolved?.legacyLink, "[[Ghost.paper]]");
  assert.equal(unresolved?.paperId, undefined);
  assert.equal(unresolved?.note, undefined);
  assert.match(await fs.readText(LIST), /Ghost/);
});

test("a list whose failure is reported goes to the app log, not the console", async () => {
  const fs = await setup();
  await fs.writeFile(P1, (await fs.readText(P1)).replace("---\n", "---\nlists: [oops\n"));
  const reports: AppLogInput[] = [];
  await migrateLegacyLists(fs, () => ROOT, (input) => reports.push(input));
  assert.equal(reports.length, 1);
  assert.equal(reports[0]!.level, "warn");
  assert.match(reports[0]!.message, /review--l1\.list\.md/);
});

test("a list that stays legacy is not re-read on the next run while its text and members are unchanged", async () => {
  const fs = await setup();
  await fs.writeFile(P1, (await fs.readText(P1)).replace("---\n", "---\nlists: [oops\n"));
  // The link index reads each paper once per snapshot; a skipped list adds no read of its own.
  const probe = countingReads(fs, P1);
  await new LinkIndex(probe.fs, () => ROOT).snapshot();
  const perSnapshot = probe.reads();
  const counted = countingReads(fs, P1);
  await migrateLegacyLists(counted.fs, () => ROOT, () => {});
  assert.ok(counted.reads() > perSnapshot, "the first run reads the member to try the move");
  const afterFirst = counted.reads();
  await migrateLegacyLists(counted.fs, () => ROOT, () => {});
  assert.equal(counted.reads() - afterFirst, perSnapshot);
});

test("a list file changed on disk during the rewrite is not overwritten and stays legacy", async () => {
  const fs = await setup();
  const edited = `${oldListFile()}outside edit\n`;
  const racing = new Proxy(fs, {
    get(target, key) {
      if (key === "writeTextIf") {
        return async (path: string, text: string, expected: string | null) => {
          if (path === LIST) await target.writeFile(LIST, edited);
          return target.writeTextIf!(path, text, expected);
        };
      }
      const v = Reflect.get(target, key, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  await migrateLegacyLists(racing, () => ROOT);
  assert.equal(await fs.readText(LIST), edited);
  assert.match(await fs.readText(LIST), /^members:/m);
});

test("one list that cannot be migrated stays legacy; the other lists still migrate", async () => {
  const fs = await setup();
  const LIST2 = `${ROOT}/reading-lists/other--l2.list.md`;
  const LINK2 = "[[other--l2.list]]";
  await fs.writeFile(
    LIST2,
    oldListFile().replace('"l1"', '"l2"').replace('members: ["[[paper-one.paper]]", "[[Ghost.paper]]"]', 'members: ["[[paper-two.paper]]"]'),
  );
  // P1's own lists value is broken, so the first list cannot be rewritten.
  await fs.writeFile(P1, (await fs.readText(P1)).replace("---\n", "---\nlists: [oops\n"));
  await migrateLegacyLists(fs, () => ROOT);
  assert.match(await fs.readText(LIST), /^members:/m);
  assert.deepEqual(readMemberFields(await fs.readText(P2)).lists, [LINK2]);
  assert.doesNotMatch(await fs.readText(LIST2), /^members:/m);
});
