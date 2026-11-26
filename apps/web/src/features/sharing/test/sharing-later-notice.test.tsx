import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { SharingLaterBody } from "../ui/sharing-later-notice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("SharingLaterBody: files mode says sharing returns in 0.9.8 and closes", () => {
  let closed = 0;
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(createElement(SharingLaterBody, { onClose: () => closed++ }));
  });
  const text = JSON.stringify(renderer!.toJSON());
  assert.match(text, /0\.9\.8/);
  assert.match(text, /live collaboration/);
  const close = renderer!.root.findAll((n) => n.type === "button" && JSON.stringify(n.props.children ?? "").includes("Close"));
  assert.ok(close.length > 0, "a Close button");
  act(() => close[0]!.props.onClick());
  assert.ok(closed > 0);
});

test("ShareDialog: files mode shows the notice and never loads shares", () => {
  const src = readFileSync(new URL("../ui/share-dialog.tsx", import.meta.url), "utf8");
  const head = src.slice(src.indexOf("export function ShareDialog("), src.indexOf("function ManageShareDialog("));
  assert.match(head, /getContainer\(\)\.workspace\.filesMode/);
  assert.match(head, /SharingLaterNotice/);
  assert.doesNotMatch(head, /manageSharing|useState|useEffect/);
});
