/**
 * The sheet's image URL map (21-07, 21-22): fallbacks run in parallel and one
 * failure keeps the rest; a path change only fetches the new paths and only
 * revokes the removed ones, so an image still on screen keeps its URL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { useObjectUrls } from "../ui/use-ink-sheet-images";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => new Promise((r) => setTimeout(r, 0));

function withRevokeSpy(run: (revoked: string[]) => Promise<void>) {
  return async () => {
    const revoked: string[] = [];
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = (url: string) => void revoked.push(url);
    try {
      await run(revoked);
    } finally {
      URL.revokeObjectURL = original;
    }
  };
}

function mount(fetchOne: (p: string) => Promise<Blob | null>, fetchMany?: (ps: readonly string[]) => Promise<Map<string, Blob>>) {
  let seen: ReadonlyMap<string, string> = new Map();
  function Host({ paths }: { paths: string[] }) {
    seen = useObjectUrls(paths, fetchOne, fetchMany);
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  return {
    get seen() {
      return seen;
    },
    async render(paths: string[]) {
      act(() => {
        if (renderer) renderer.update(createElement(Host, { paths }));
        else renderer = create(createElement(Host, { paths }));
      });
      await act(async () => {
        await flush();
        await flush();
      });
    },
    unmount: () => act(() => renderer.unmount()),
  };
}

test("fallback fetches run in parallel; one failure keeps the others (21-07)", async () => {
  let inFlight = 0;
  let peak = 0;
  const fetchOne = async (p: string) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await flush();
    inFlight -= 1;
    if (p === "bad") throw new Error("boom");
    return new Blob([p]);
  };
  const h = mount(fetchOne, async () => new Map());
  await h.render(["a", "bad", "c"]);
  assert.equal(peak, 3);
  assert.deepEqual([...h.seen.keys()].sort(), ["a", "c"]);
  h.unmount();
});

test("adding a path keeps the old URLs alive and fetches only the new one (21-22)", withRevokeSpy(async (revoked) => {
  const asked: string[] = [];
  const h = mount(async (p) => (asked.push(p), new Blob([p])));
  await h.render(["a"]);
  const a = h.seen.get("a");
  await h.render(["a", "b"]);
  assert.equal(h.seen.get("a"), a);
  assert.match(h.seen.get("b") ?? "", /^blob:/);
  assert.deepEqual(asked, ["a", "b"]);
  assert.deepEqual(revoked, []);
}));

test("removing a path revokes only it; emptying and unmount revoke the rest", withRevokeSpy(async (revoked) => {
  const h = mount(async (p) => new Blob([p]));
  await h.render(["a", "b"]);
  const { a, b } = { a: h.seen.get("a")!, b: h.seen.get("b")! };
  await h.render(["a"]);
  assert.deepEqual(revoked, [b]);
  assert.equal(h.seen.get("a"), a);
  assert.equal(h.seen.has("b"), false);
  await h.render([]);
  assert.deepEqual(revoked, [b, a]);
  assert.equal(h.seen.size, 0);
  await h.render(["c"]);
  const c = h.seen.get("c")!;
  h.unmount();
  assert.deepEqual(revoked, [b, a, c]);
}));

test("a fetch that lands after unmount makes no URL", withRevokeSpy(async (revoked) => {
  let land: (b: Blob) => void = () => {};
  let created = 0;
  const original = URL.createObjectURL;
  URL.createObjectURL = (b: Blob) => (created += 1, original(b));
  try {
    const h = mount(() => new Promise<Blob>((r) => (land = r)));
    await h.render(["late"]);
    h.unmount();
    await act(async () => {
      land(new Blob(["x"]));
      await flush();
    });
    assert.equal(created, 0);
    assert.deepEqual(revoked, []);
  } finally {
    URL.createObjectURL = original;
  }
}));
