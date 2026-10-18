import { test } from "node:test";
import assert from "node:assert/strict";

import { isPlainClick, motionTier, navTransition, transitionsOn } from "../view-transition";

test("tiers: calm by default, reactive with the setting, CRT by theme, off when reduced or unsupported", () => {
  const base = { motion: undefined, theme: undefined, reducedMotion: false, supported: true };
  assert.equal(motionTier(base), "calm");
  assert.equal(motionTier({ ...base, motion: "reactive" }), "reactive");
  assert.equal(motionTier({ ...base, theme: "crt" }), "crt");
  assert.equal(motionTier({ ...base, theme: "crt", motion: "reactive" }), "crt");
  assert.equal(motionTier({ ...base, theme: "brutal" }), "calm");
  assert.equal(motionTier({ ...base, reducedMotion: true }), "off");
  assert.equal(motionTier({ ...base, motion: "reactive", theme: "crt", reducedMotion: true }), "off");
  assert.equal(motionTier({ ...base, supported: false }), "off");
});

test("transitions run without the motion setting, never when reduced", () => {
  const base = { motion: undefined, theme: undefined, reducedMotion: false, supported: true };
  assert.equal(transitionsOn(base), true);
  assert.equal(transitionsOn({ ...base, reducedMotion: true }), false);
  assert.equal(transitionsOn({ ...base, supported: false }), false);
});

test("only a plain left click is taken over", () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  assert.equal(isPlainClick(click), true);
  assert.equal(isPlainClick({ ...click, ctrlKey: true }), false, "ctrl opens a new window");
  assert.equal(isPlainClick({ ...click, button: 1 }), false);
  assert.equal(isPlainClick({ ...click, defaultPrevented: true }), false);
});

test("without the API the navigation still happens, straight away", () => {
  let went = 0;
  navTransition("forward", () => went++);
  assert.equal(went, 1);
});

test("the update settles without animation frames, which the browser pauses inside it", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = ["document", "window", "location", "MutationObserver", "requestAnimationFrame"].map((k) => [k, g[k]] as const);
  let settled: Promise<void> | null = null;
  const root = { dataset: {} as Record<string, string> };
  const page = new Set<string>();
  let pageTaggedWhileNav = false;
  g.location = { href: "app://weaveforge/papers/" };
  g.window = { matchMedia: () => ({ matches: false }) };
  g.requestAnimationFrame = () => 0;
  g.MutationObserver = class { observe() {} disconnect() {} };
  g.document = {
    documentElement: root,
    body: {},
    querySelectorAll: () => [{ classList: { add: (c: string) => { page.add(c); pageTaggedWhileNav = "nav" in root.dataset; } } }],
    startViewTransition: (update: () => Promise<void>) => {
      settled = update();
      return { finished: settled };
    },
  };
  try {
    navTransition("tab", () => { (g.location as { href: string }).href = "app://weaveforge/notes/"; });
    const t0 = performance.now();
    const won = await Promise.race([settled!.then(() => true), new Promise((r) => setTimeout(() => r(false), 1500))]);
    assert.equal(won, true, "update callback hung waiting for a frame");
    assert.ok(performance.now() - t0 < 1000);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(root.dataset.nav, undefined);
    assert.ok(page.has("page-transition--vt") && pageTaggedWhileNav, "page tagged before data-nav clears, so page-in does not replay");
  } finally {
    for (const [k, v] of saved) g[k] = v;
  }
});

test("routeSettled: URL moves in navigate callback, then mutation fires -> resolves under 50 ms", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = ["document", "window", "location", "MutationObserver", "requestAnimationFrame"].map((k) => [k, g[k]] as const);
  let settled: Promise<void> | null = null;
  let observerCallback: () => void = () => {};
  g.location = { href: "app://weaveforge/papers/" };
  g.window = { matchMedia: () => ({ matches: false }) };
  g.requestAnimationFrame = () => 0;
  g.MutationObserver = class {
    constructor(cb: () => void) {
      observerCallback = cb;
    }
    observe() {}
    disconnect() {}
  };
  g.document = {
    documentElement: { dataset: {} as Record<string, string> },
    body: {},
    querySelectorAll: () => [],
    startViewTransition: (update: () => Promise<void>) => {
      settled = update();
      return { finished: settled };
    },
  };
  try {
    const t0 = performance.now();
    navTransition("tab", () => {
      (g.location as { href: string }).href = "app://weaveforge/notes/";
    });
    observerCallback();
    await settled;
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 50, `expected < 50 ms, got ${elapsed} ms`);
  } finally {
    for (const [k, v] of saved) g[k] = v;
  }
});

test("routeSettled: mutation fires while URL unchanged, then URL changes ~5 ms later -> resolves under 100 ms", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = ["document", "window", "location", "MutationObserver", "requestAnimationFrame"].map((k) => [k, g[k]] as const);
  let settled: Promise<void> | null = null;
  let observerCallback: () => void = () => {};
  g.location = { href: "app://weaveforge/papers/" };
  g.window = { matchMedia: () => ({ matches: false }) };
  g.requestAnimationFrame = () => 0;
  g.MutationObserver = class {
    constructor(cb: () => void) {
      observerCallback = cb;
    }
    observe() {}
    disconnect() {}
  };
  g.document = {
    documentElement: { dataset: {} as Record<string, string> },
    body: {},
    querySelectorAll: () => [],
    startViewTransition: (update: () => Promise<void>) => {
      settled = update();
      return { finished: settled };
    },
  };
  try {
    const t0 = performance.now();
    navTransition("tab", () => {
      // URL not changed yet
    });
    observerCallback();
    setTimeout(() => {
      (g.location as { href: string }).href = "app://weaveforge/notes/";
    }, 5);
    await settled;
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 100, `expected < 100 ms, got ${elapsed} ms`);
  } finally {
    for (const [k, v] of saved) g[k] = v;
  }
});

test("routeSettled: neither mutation nor URL change -> resolves via timeout between 450 ms and 1000 ms", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = ["document", "window", "location", "MutationObserver", "requestAnimationFrame"].map((k) => [k, g[k]] as const);
  let settled: Promise<void> | null = null;
  g.location = { href: "app://weaveforge/papers/" };
  g.window = { matchMedia: () => ({ matches: false }) };
  g.requestAnimationFrame = () => 0;
  g.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  g.document = {
    documentElement: { dataset: {} as Record<string, string> },
    body: {},
    querySelectorAll: () => [],
    startViewTransition: (update: () => Promise<void>) => {
      settled = update();
      return { finished: settled };
    },
  };
  try {
    const t0 = performance.now();
    navTransition("tab", () => {
      // URL not changed
    });
    await settled;
    const elapsed = performance.now() - t0;
    assert.ok(elapsed >= 450 && elapsed < 1000, `expected between 450 ms and 1000 ms, got ${elapsed} ms`);
  } finally {
    for (const [k, v] of saved) g[k] = v;
  }
});

test("routeSettled: observer is disconnected after resolve", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = ["document", "window", "location", "MutationObserver", "requestAnimationFrame"].map((k) => [k, g[k]] as const);
  let settled: Promise<void> | null = null;
  let observerCallback: () => void = () => {};
  let disconnectCalls = 0;
  g.location = { href: "app://weaveforge/papers/" };
  g.window = { matchMedia: () => ({ matches: false }) };
  g.requestAnimationFrame = () => 0;
  g.MutationObserver = class {
    constructor(cb: () => void) {
      observerCallback = cb;
    }
    observe() {}
    disconnect() {
      disconnectCalls++;
    }
  };
  g.document = {
    documentElement: { dataset: {} as Record<string, string> },
    body: {},
    querySelectorAll: () => [],
    startViewTransition: (update: () => Promise<void>) => {
      settled = update();
      return { finished: settled };
    },
  };
  try {
    navTransition("tab", () => {
      (g.location as { href: string }).href = "app://weaveforge/notes/";
    });
    assert.equal(disconnectCalls, 0);
    observerCallback();
    await settled;
    assert.equal(disconnectCalls, 1);
  } finally {
    for (const [k, v] of saved) g[k] = v;
  }
});

