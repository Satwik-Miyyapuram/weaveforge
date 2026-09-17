/**
 * The figure-URL hook must survive its host re-rendering while a fetch is on
 * its way: the figures list is rebuilt on most renders, and the image used
 * to stay pending for as long as that kept happening.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { useInkFigureUrls } from "../ui/use-ink-figure-urls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("a fetch started before a re-render still lands, and is asked for once", async () => {
  let resolve: (blob: Blob) => void = () => {};
  let calls = 0;
  const fetchBlob = () => {
    calls += 1;
    return new Promise<Blob>((r) => (resolve = r));
  };
  let seen: ReadonlyMap<string, string> = new Map();
  function Host({ tick }: { tick: number }) {
    // A new array every render, as the host builds it.
    seen = useInkFigureUrls({ fetchBlob, figures: [{ path: "p/a.png" }], });
    return createElement("i", null, tick);
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(Host, { tick: 0 }));
  });
  act(() => renderer.update(createElement(Host, { tick: 1 })));
  act(() => renderer.update(createElement(Host, { tick: 2 })));
  assert.equal(calls, 1);
  await act(async () => {
    resolve(new Blob(["x"]));
    await Promise.resolve();
  });
  assert.match(seen.get("p/a.png") ?? "", /^blob:/);
});
