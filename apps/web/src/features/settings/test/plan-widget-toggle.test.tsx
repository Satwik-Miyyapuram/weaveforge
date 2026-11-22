/**
 * The deadlines widget toggle shows whenever the bridge supports the widget. Signed-in
 * desktop is not always files mode (it is files mode only with a workspace folder), so
 * the toggle says where the deadlines come from and what the card shows without a folder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { PlanWidgetToggle } from "../ui/plan-widget-toggle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function withBridge(state: { supported: boolean; enabled: boolean }, run: (calls: () => boolean[]) => Promise<void>) {
  return async () => {
    const g = globalThis as Record<string, unknown>;
    const saved = g.window;
    const calls: boolean[] = [];
    g.window = {
      weaveforge: {
        fetchTitle() {},
        planWidgetState: async () => state,
        setPlanWidget: async (on: boolean) => {
          calls.push(on);
          return { supported: true, enabled: on };
        },
      },
    };
    try {
      await run(() => calls);
    } finally {
      g.window = saved;
    }
  };
}

test("files mode: the deadlines toggle shows with no local-copy condition", withBridge({ supported: true, enabled: false }, async () => {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(createElement(PlanWidgetToggle));
  });
  const json = JSON.stringify(tree!.toJSON());
  assert.match(json, /"type":"input"/, "the checkbox is shown");
  assert.doesNotMatch(json, /Keep a copy here/, "no instruction to keep a local copy");
}));

test("the toggle says the deadlines come from the workspace folder, and the card stays empty without one", withBridge({ supported: true, enabled: false }, async () => {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(createElement(PlanWidgetToggle));
  });
  const json = JSON.stringify(tree!.toJSON());
  assert.match(json, /workspace folder on this computer/, "the source of the deadlines is named");
  assert.match(json, /Without a folder open, the card stays empty/, "the empty state is explained");
}));

test("files mode: switching the toggle on calls the bridge with true", withBridge({ supported: true, enabled: false }, async (calls) => {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(createElement(PlanWidgetToggle));
  });
  const input = tree!.root.findByType("input");
  await act(async () => {
    input.props.onChange({ target: { checked: true } });
  });
  assert.deepEqual(calls(), [true]);
}));
