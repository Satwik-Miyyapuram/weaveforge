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

test("unmounting revokes every URL it made, and a late fetch makes none (21-04)", async () => {
  const revoked: string[] = [];
  const original = URL.revokeObjectURL;
  URL.revokeObjectURL = (url: string) => void revoked.push(url);
  try {
    const pending: ((blob: Blob) => void)[] = [];
    const fetchBlob = (path: string) =>
      path === "late.png" ? new Promise<Blob>((r) => pending.push(r)) : Promise.resolve(new Blob([path]));
    let seen: ReadonlyMap<string, string> = new Map();
    const figures = [{ path: "a.png" }, { path: "b.png" }, { path: "late.png" }];
    function Host() {
      seen = useInkFigureUrls({ fetchBlob, figures });
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(createElement(Host));
      await new Promise((r) => setTimeout(r, 0));
    });
    const made = [...seen.values()];
    assert.equal(made.length, 2);
    assert.deepEqual(revoked, [], "nothing is revoked while shown");
    act(() => renderer.unmount());
    assert.deepEqual([...revoked].sort(), [...made].sort());
    await act(async () => {
      pending[0]!(new Blob(["late"]));
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.equal(revoked.length, 2);
  } finally {
    URL.revokeObjectURL = original;
  }
});
