import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { downloadText, ModelDownloadLine } from "../ui/model-download-line";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MB = 1024 * 1024;

const textOf = (children: unknown): string =>
  typeof children === "string" ? children : Array.isArray(children) ? children.map(textOf).join("") : "";

test("downloadText sums the files and names the full size when every size is known", () => {
  assert.equal(
    downloadText([
      { file: "model.onnx", done: 12 * MB, total: 80 * MB },
      { file: "tokenizer.json", done: 1 * MB, total: 2 * MB },
    ]),
    "13 MB of 82 MB",
  );
  assert.equal(downloadText([{ file: "model.onnx", done: 1.5 * MB, total: null }]), "1.5 MB so far");
});

test("the line shows the bytes so far and Cancel stops the downloads", async () => {
  let cancelled = 0;
  const bridge = {
    modelDownloads: async () => [{ file: "model.onnx", done: 30 * MB, total: 90 * MB }],
    cancelModelDownloads: async () => {
      cancelled += 1;
    },
  };
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(createElement(ModelDownloadLine, { bridge }));
  });
  assert.match(JSON.stringify(tree!.toJSON()), /30 MB of 90 MB/);

  const button = tree!.root.find((n) => n.type === "button" && textOf(n.props.children) === "Cancel");
  await act(async () => button.props.onClick());

  assert.equal(cancelled, 1);
  assert.match(JSON.stringify(tree!.toJSON()), /Stopping…/);
  await act(async () => tree!.unmount());
});

test("nothing shows when no download runs or the shell has no download list", async () => {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(
      createElement(ModelDownloadLine, {
        bridge: { modelDownloads: async () => [], cancelModelDownloads: async () => {} },
      }),
    );
  });
  assert.equal(tree!.toJSON(), null);
  await act(async () => tree!.update(createElement(ModelDownloadLine, { bridge: null })));
  assert.equal(tree!.toJSON(), null);
  await act(async () => tree!.unmount());
});
