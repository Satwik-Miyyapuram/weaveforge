/**
 * A save with no OS keychain shows the install help with Try again and Close,
 * and nothing else. Try again retries; Close only dismisses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import ReactDOM from "react-dom";
import { act, create } from "react-test-renderer";

import { KEYCHAIN_HELP } from "@/backend/providers/local/parts";
import { KeychainMissingDialog } from "../ui/keychain-missing-dialog";

type Json = string | { children?: Json[] | null } | null;
/** The visible text under a rendered node. */
const textOf = (node: Json): string =>
  node === null ? "" : typeof node === "string" ? node : (node.children ?? []).map(textOf).join("");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The node runner has no DOM: render the portal in place, as the modal test does.
(ReactDOM as unknown as { createPortal: (node: unknown) => unknown }).createPortal = (node) => node;
Object.assign(globalThis, {
  document: {
    body: { style: {} },
    documentElement: { clientWidth: 0 },
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
  },
  window: { innerWidth: 0 },
});

test("names the keychain, gives the install command, and offers Try again and Close", async () => {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(<KeychainMissingDialog onClose={() => {}} onRetry={() => {}} />);
  });
  const text = textOf(tree!.toJSON() as Json);
  assert.ok(text.includes("Keychain needed"));
  assert.ok(text.includes("Install"), "the install help is shown");
  assert.ok(text.includes(KEYCHAIN_HELP.slice(0, 40)));
  const labels = tree!.root.findAllByType("button").map((b) => textOf(b as unknown as Json));
  assert.ok(labels.some((l) => l === "Try again"));
  assert.ok(labels.some((l) => l === "Close"));
  await act(async () => tree!.unmount());
});

test("Try again calls onRetry and Close calls onClose, one each", async () => {
  const calls: string[] = [];
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(
      <KeychainMissingDialog onClose={() => calls.push("close")} onRetry={() => calls.push("retry")} />,
    );
  });
  const button = (label: string) =>
    tree!.root.findAllByType("button").find((b) => textOf(b as unknown as Json) === label)!;
  await act(async () => button("Try again").props.onClick());
  await act(async () => button("Close").props.onClick());
  assert.deepEqual(calls, ["retry", "close"]);
  await act(async () => tree!.unmount());
});
