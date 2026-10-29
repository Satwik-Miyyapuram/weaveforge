import { test } from "node:test";
import assert from "node:assert/strict";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { InkTextLayer } from "../ui/ink-text-layer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const lines = [{ text: "helo", conf: 0.4, alternatives: ["hello", "help"] }];

function renderLayer(accepted: [number, string][]): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <InkTextLayer
        lines={lines}
        confidence={0.4}
        progress={null}
        unavailable={null}
        onAccept={(index, text) => accepted.push([index, text])}
      />,
    );
  });
  act(() => tree.root.findByType("p").props.onClick());
  return tree;
}

/**
 * The browser's order for a click on an alternative while the field has
 * focus: mousedown, then (unless prevented) the field's blur, then click.
 */
function pressAlternative(tree: ReactTestRenderer, label: string) {
  const button = () => tree.root.findAll((n) => n.type === "button" && n.children[0] === label)[0];
  let prevented = false;
  act(() => button()?.props.onMouseDown?.({ preventDefault: () => (prevented = true) }));
  if (!prevented) act(() => tree.root.findByType("input").props.onBlur());
  const still = button();
  if (still) act(() => still.props.onClick());
}

test("clicking an alternative applies it, not the draft (21-03)", () => {
  const accepted: [number, string][] = [];
  const tree = renderLayer(accepted);
  pressAlternative(tree, "help");
  assert.deepEqual(accepted, [[0, "help"]]);
  assert.equal(tree.root.findAllByType("input").length, 0, "the editor closes");
});

test("blurring the field still accepts the typed draft", () => {
  const accepted: [number, string][] = [];
  const tree = renderLayer(accepted);
  act(() => tree.root.findByType("input").props.onChange({ target: { value: "hullo" } }));
  act(() => tree.root.findByType("input").props.onBlur());
  assert.deepEqual(accepted, [[0, "hullo"]]);
});

test("the Enter that confirms an IME composition does not accept the line", () => {
  const accepted: [number, string][] = [];
  const tree = renderLayer(accepted);
  const input = () => tree.root.findByType("input");
  act(() => input().props.onChange({ target: { value: "にほ" } }));
  act(() => input().props.onKeyDown({ key: "Enter", nativeEvent: { isComposing: true } }));
  act(() => input().props.onKeyDown({ key: "Enter", keyCode: 229, nativeEvent: {} }));
  assert.deepEqual(accepted, []);
  assert.equal(tree.root.findAllByType("input").length, 1, "the editor stays open");
  act(() => input().props.onChange({ target: { value: "日本" } }));
  act(() => input().props.onKeyDown({ key: "Enter", nativeEvent: {} }));
  assert.deepEqual(accepted, [[0, "日本"]]);
});
