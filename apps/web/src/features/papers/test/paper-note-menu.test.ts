/** The paper page's right-click menu. */
import assert from "node:assert/strict";
import test from "node:test";
import type { MenuItem } from "../../../components/menu";
import { paperNoteMenuItems, type PaperNoteMenu } from "../ui/paper-note-menu";

function menu(over: Partial<PaperNoteMenu> = {}): PaperNoteMenu & { ran: string[] } {
  const ran: string[] = [];
  return {
    ran,
    readOnly: false,
    busy: false,
    hasReader: true,
    watching: false,
    canWatch: true,
    status: "to_read",
    statuses: ["to_read", "reading", "read"],
    statusLabel: (s: string) => s.toUpperCase(),
    openInEditor: () => ran.push("open-editor"),
    openReader: () => ran.push("open-reader"),
    copyCitation: () => ran.push("cite"),
    copyTitle: () => ran.push("copy-title"),
    setStatus: (s: string) => ran.push(`status:${s}`),
    toggleWatch: () => ran.push("watch"),
    editIdentifiers: () => ran.push("ids"),
    remove: () => ran.push("delete"),
    ...over,
  };
}

const ids = (items: readonly MenuItem[]) => items.filter((i) => i.kind !== "separator").map((i) => i.id);

test("an owner sees every action, delete last", () => {
  assert.deepEqual(ids(paperNoteMenuItems(menu())), [
    "open-editor", "open-reader", "cite", "copy-title", "status", "watch", "ids", "delete",
  ]);
});

test("a shared, read-only paper offers only what does not change it", () => {
  assert.deepEqual(ids(paperNoteMenuItems(menu({ readOnly: true }))), ["open-reader", "cite", "copy-title"]);
});

test("no PDF or web page means no reader item", () => {
  assert.ok(!ids(paperNoteMenuItems(menu({ hasReader: false }))).includes("open-reader"));
});

test("the status submenu marks the current status and sets the picked one", () => {
  const m = menu();
  const status = paperNoteMenuItems(m).find((i: MenuItem) => i.id === "status")!;
  const items = status.submenu as MenuItem[];
  assert.deepEqual(items.map((i: MenuItem) => i.label), ["TO_READ", "READING", "READ"]);
  assert.equal(items[0]!.checked, true);
  items[2]!.onSelect?.();
  assert.deepEqual(m.ran, ["status:read"]);
});

test("watch names the next state, and needs an identifier", () => {
  assert.equal(paperNoteMenuItems(menu({ watching: true })).find((i: MenuItem) => i.id === "watch")!.label, "Stop citation alerts");
  assert.ok(!ids(paperNoteMenuItems(menu({ canWatch: false }))).includes("watch"));
});

test("while busy, changes are disabled", () => {
  const items = paperNoteMenuItems(menu({ busy: true }));
  for (const id of ["status", "delete"]) assert.equal(items.find((i: MenuItem) => i.id === id)!.disabled, true, id);
});
