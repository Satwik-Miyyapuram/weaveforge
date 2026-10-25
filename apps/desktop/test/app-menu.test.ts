import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PAGE_COMMAND_EVENT } from "../src/app-menu";

// The menu asks the page through a DOM event, not IPC, so CHANNELS cannot keep
// the two names in step. This does (xipc-19).
test("app menu: the page command event is the name the web title bar listens for", () => {
  const titleBar = fs.readFileSync(
    path.join(__dirname, "../../web/src/components/desktop-title-bar.tsx"),
    "utf8",
  );
  const declared = titleBar.match(/const MENU_COMMAND_EVENT = "([^"]+)";/);
  assert.ok(declared, "desktop-title-bar.tsx no longer declares MENU_COMMAND_EVENT");
  assert.equal(declared[1], PAGE_COMMAND_EVENT);
});
