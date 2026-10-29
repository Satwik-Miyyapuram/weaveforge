/**
 * The figure-URL hook must survive its host re-rendering while a fetch is on
 * its way: the figures list is rebuilt on most renders, and the image used
 * to stay pending for as long as that kept happening.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { StrictMode, createElement, useLayoutEffect } from "react";
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

/** Counts the blob URLs made and revoked, and restores the real ones after. */
function stubBlobUrls() {
  const created: string[] = [];
  const revoked: string[] = [];
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  let next = 0;
  URL.createObjectURL = () => {
    const url = `blob:stub/${next++}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => void revoked.push(url);
  return {
    created,
    revoked,
    restore: () => {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    },
  };
}

test("a rejected fetch makes no URL and revokes nothing", async () => {
  const blobUrls = stubBlobUrls();
  try {
    const fetchBlob = () => Promise.reject(new Error("missing"));
    let seen: ReadonlyMap<string, string> = new Map();
    function Host() {
      seen = useInkFigureUrls({ fetchBlob, figures: [{ path: "gone.png" }] });
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(createElement(Host));
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => renderer.unmount());
    assert.equal(seen.size, 0);
    assert.deepEqual(blobUrls.created, []);
    assert.deepEqual(blobUrls.revoked, []);
  } finally {
    blobUrls.restore();
  }
});

test("unmounting while a fetch is in flight makes no URL once it resolves", async () => {
  const blobUrls = stubBlobUrls();
  try {
    let resolve: (blob: Blob) => void = () => {};
    const fetchBlob = () => new Promise<Blob>((r) => (resolve = r));
    function Host() {
      useInkFigureUrls({ fetchBlob, figures: [{ path: "slow.png" }] });
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(createElement(Host));
    });
    act(() => renderer.unmount());
    await act(async () => {
      resolve(new Blob(["late"]));
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.deepEqual(blobUrls.created, []);
    assert.deepEqual(blobUrls.revoked, []);
  } finally {
    blobUrls.restore();
  }
});

test("a re-render does not revoke a URL that is still shown", async () => {
  const blobUrls = stubBlobUrls();
  try {
    const fetchBlob = () => Promise.resolve(new Blob(["x"]));
    let seen: ReadonlyMap<string, string> = new Map();
    function Host({ tick }: { tick: number }) {
      seen = useInkFigureUrls({ fetchBlob, figures: [{ path: "a.png" }] });
      return createElement("i", null, tick);
    }
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(createElement(Host, { tick: 0 }));
      await new Promise((r) => setTimeout(r, 0));
    });
    const shown = seen.get("a.png");
    assert.ok(shown, "the URL is shown after the fetch");
    act(() => renderer.update(createElement(Host, { tick: 1 })));
    act(() => renderer.update(createElement(Host, { tick: 2 })));
    assert.equal(seen.get("a.png"), shown);
    // The URL is still a live one: made by us, and never revoked.
    assert.ok(blobUrls.created.includes(shown!), "the shown URL was made here");
    assert.ok(!blobUrls.revoked.includes(shown!), "the shown URL is not revoked");
    assert.deepEqual(blobUrls.revoked, []);
  } finally {
    blobUrls.restore();
  }
});

test("a figure that leaves the page is revoked and dropped; one still shown is kept", async () => {
  const blobUrls = stubBlobUrls();
  try {
    const fetchBlob = () => Promise.resolve(new Blob(["x"]));
    let seen: ReadonlyMap<string, string> = new Map();
    function Host({ paths }: { paths: string[] }) {
      seen = useInkFigureUrls({ fetchBlob, figures: paths.map((path) => ({ path })) });
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(createElement(Host, { paths: ["a.png", "b.png"] }));
      await new Promise((r) => setTimeout(r, 0));
    });
    const shownA = seen.get("a.png");
    const shownB = seen.get("b.png");
    assert.ok(shownA && shownB, "both figures are shown after the fetch");
    // A page turn: only b.png is still on the page.
    act(() => renderer.update(createElement(Host, { paths: ["b.png"] })));
    assert.equal(seen.has("a.png"), false, "the left figure is dropped");
    assert.equal(seen.get("b.png"), shownB, "the figure still on the page keeps its URL");
    assert.deepEqual(blobUrls.revoked, [shownA], "only the left figure's blob is freed");
  } finally {
    blobUrls.restore();
  }
});

test("a fetch for a figure that left the page while in flight makes no URL", async () => {
  const blobUrls = stubBlobUrls();
  try {
    let resolve: (blob: Blob) => void = () => {};
    const fetchBlob = () => new Promise<Blob>((r) => (resolve = r));
    let seen: ReadonlyMap<string, string> = new Map();
    function Host({ paths }: { paths: string[] }) {
      seen = useInkFigureUrls({ fetchBlob, figures: paths.map((path) => ({ path })) });
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(createElement(Host, { paths: ["slow.png"] }));
    });
    act(() => renderer.update(createElement(Host, { paths: [] })));
    await act(async () => {
      resolve(new Blob(["late"]));
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.equal(seen.size, 0, "nothing is shown for a figure that is no longer wanted");
    assert.deepEqual(blobUrls.created, [], "no blob URL is made for it");
  } finally {
    blobUrls.restore();
  }
});

test("a failed fetch is asked again on a later render (the intended retry)", async () => {
  const blobUrls = stubBlobUrls();
  try {
    let calls = 0;
    const fetchBlob = () => {
      calls += 1;
      return Promise.reject(new Error("missing"));
    };
    function Host({ tick }: { tick: number }) {
      useInkFigureUrls({ fetchBlob, figures: [{ path: "gone.png" }] });
      return createElement("i", null, tick);
    }
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(createElement(Host, { tick: 0 }));
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.equal(calls, 1);
    await act(async () => {
      renderer.update(createElement(Host, { tick: 1 }));
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.equal(calls, 2, "a later render asks for the missing path again");
    assert.deepEqual(blobUrls.created, []);
  } finally {
    blobUrls.restore();
  }
});

test("under StrictMode's double effect at mount, the URL still shows once fetched", async () => {
  const blobUrls = stubBlobUrls();
  try {
    let calls = 0;
    const fetchBlob = () => {
      calls += 1;
      return Promise.resolve(new Blob(["x"]));
    };
    let seen: ReadonlyMap<string, string> = new Map();
    function Host() {
      seen = useInkFigureUrls({ fetchBlob, figures: [{ path: "a.png" }] });
      return null;
    }
    await act(async () => {
      create(createElement(StrictMode, null, createElement(Host)));
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.equal(calls, 1, "the path is asked for once");
    assert.deepEqual(seen.get("a.png"), blobUrls.created[0]);
    assert.deepEqual(blobUrls.revoked, []);
  } finally {
    blobUrls.restore();
  }
});

test("a fetch landing between commit and the effect, for a figure that then leaves, is revoked", async () => {
  const blobUrls = stubBlobUrls();
  try {
    // a.png answers only when told, and synchronously, so it can land in the
    // gap after a commit and before the passive effect runs.
    let landA: (blob: Blob) => void = () => {};
    const fetchBlob = (path: string) =>
      path === "a.png"
        ? ({
            then: (ok: (blob: Blob) => void) => {
              landA = ok;
              return { catch: () => ({ finally: () => undefined }) };
            },
          } as unknown as Promise<Blob>)
        : Promise.resolve(new Blob([path]));
    let seen: ReadonlyMap<string, string> = new Map();
    function Lander({ fire }: { fire: boolean }) {
      useLayoutEffect(() => {
        if (fire) landA(new Blob(["a"]));
      }, [fire]);
      return null;
    }
    function Host({ paths, fire }: { paths: string[]; fire: boolean }) {
      seen = useInkFigureUrls({ fetchBlob, figures: paths.map((path) => ({ path })) });
      return createElement(Lander, { fire });
    }
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(createElement(Host, { paths: ["a.png", "b.png", "c.png"], fire: false }));
      await new Promise((r) => setTimeout(r, 0));
    });
    // A page turn leaves only b.png; a.png's fetch lands in the same commit.
    act(() => renderer.update(createElement(Host, { paths: ["b.png"], fire: true })));
    assert.deepEqual([...seen.keys()], ["b.png"]);
    const leaked = blobUrls.created.filter(
      (url) => url !== seen.get("b.png") && !blobUrls.revoked.includes(url),
    );
    assert.deepEqual(leaked, [], "every URL not shown is revoked");
  } finally {
    blobUrls.restore();
  }
});
