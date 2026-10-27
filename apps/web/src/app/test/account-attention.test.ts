/**
 * What needs the person sits on the account icon as one count, and the menu
 * lists each item on top. A green dot alone under the sidebar said nothing
 * worth a row, and conflicts and AI suggestions had no shared place.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { accountAttention } from "../account-attention";
import type { InboxLink } from "../inbox-links";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const ai = (badge?: number): InboxLink => ({
  key: "ai-review", label: "AI suggestions", path: "/ai-review", icon: "sparkle", ...(badge ? { badge } : {}),
});
const shared: InboxLink = { key: "shared", label: "Shared with you", path: "/shared", icon: "share" };

test("nothing waiting: no rows and no count", () => {
  assert.deepEqual(accountAttention({ conflicts: 0, inbox: [ai(), shared], inboxInMenu: false }), { rows: [], total: 0 });
});

test("conflicts and AI suggestions add up, conflicts first", () => {
  const a = accountAttention({ conflicts: 2, inbox: [ai(3), shared], inboxInMenu: false });
  assert.equal(a.total, 5);
  assert.deepEqual(a.rows.map((r) => [r.key, r.label, r.path, r.badge]), [
    ["sync-conflicts", "Sync conflicts", "/settings#settings-sync", 2],
    ["ai-review", "AI suggestions", "/ai-review", 3],
  ]);
});

test("rows without a count are not attention", () => {
  const a = accountAttention({ conflicts: 0, inbox: [ai(1), shared], inboxInMenu: false });
  assert.deepEqual(a.rows.map((r) => r.key), ["ai-review"]);
});

test("where the menu already lists the Inbox, it is counted but not listed twice", () => {
  const a = accountAttention({ conflicts: 1, inbox: [ai(4)], inboxInMenu: true });
  assert.equal(a.total, 5);
  assert.deepEqual(a.rows.map((r) => r.key), ["sync-conflicts"]);
});

test("the account icon carries the count and the menu lists the rows", () => {
  const src = read("../header-actions.tsx");
  const menu = src.slice(src.indexOf("<Popover"));
  assert.match(menu, /count=\{attention\.total\}/);
  assert.match(menu, /attention\.rows\.map\(/);
  assert.match(src, /accountAttention\(\{/);
  const css = read("../styles/shell.css");
  assert.match(css, /\.account-btn \.popover-badge \{[^}]*position: absolute/);
});

test("the sidebar has no sync dot of its own any more", () => {
  assert.doesNotMatch(read("../tabbar.tsx"), /SyncStatusIndicator/);
});
