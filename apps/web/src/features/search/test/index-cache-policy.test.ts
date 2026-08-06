import assert from "node:assert/strict";
import test from "node:test";
import {
  WEB_CACHE_DOCUMENT_LIMIT,
  isInstalledApp,
  persistSearchIndex,
  shouldPersistIndex,
} from "@/features/search/infrastructure/index-cache-policy";

type Surface = { displayMode?: string; iosStandalone?: boolean; referrer?: string } | null;

/** Stand in for the browser signals that say which surface this is. */
function asSurface(surface: Surface): () => void {
  const globals = globalThis as { window?: unknown; document?: unknown };
  const previous = { window: globals.window, document: globals.document };

  if (surface === null) {
    delete globals.window;
    delete globals.document;
  } else {
    globals.window = {
      matchMedia: (query: string) => ({ matches: query.includes(surface.displayMode ?? "none") }),
      navigator: { standalone: surface.iosStandalone ?? false },
    };
    globals.document = { referrer: surface.referrer ?? "" };
  }

  return () => {
    globals.window = previous.window;
    globals.document = previous.document;
  };
}

test("an installed PWA is recognised by its display mode", () => {
  const restore = asSurface({ displayMode: "standalone" });
  try {
    assert.equal(isInstalledApp(), true);
  } finally {
    restore();
  }
});

test("a fullscreen install counts too", () => {
  const restore = asSurface({ displayMode: "fullscreen" });
  try {
    assert.equal(isInstalledApp(), true);
  } finally {
    restore();
  }
});

test("iOS reports it through its own flag", () => {
  const restore = asSurface({ iosStandalone: true });
  try {
    assert.equal(isInstalledApp(), true);
  } finally {
    restore();
  }
});

test("an Android trusted web activity is recognised by its referrer", () => {
  const restore = asSurface({ referrer: "android-app://com.weaveforge.app" });
  try {
    assert.equal(isInstalledApp(), true);
  } finally {
    restore();
  }
});

test("an ordinary browser tab is not an installed app", () => {
  const restore = asSurface({ referrer: "https://example.com/" });
  try {
    assert.equal(isInstalledApp(), false);
  } finally {
    restore();
  }
});

test("server-side rendering is not an installed app", () => {
  const restore = asSurface(null);
  try {
    assert.equal(isInstalledApp(), false);
  } finally {
    restore();
  }
});

test("the installed app persists an index of any size", () => {
  const restore = asSurface({ displayMode: "standalone" });
  try {
    assert.equal(shouldPersistIndex(WEB_CACHE_DOCUMENT_LIMIT * 10), true);
  } finally {
    restore();
  }
});

test("the website persists up to the threshold and no further", () => {
  const restore = asSurface({ referrer: "" });
  try {
    assert.equal(shouldPersistIndex(WEB_CACHE_DOCUMENT_LIMIT), true, "the limit itself is included");
    assert.equal(shouldPersistIndex(WEB_CACHE_DOCUMENT_LIMIT + 1), false);
  } finally {
    restore();
  }
});

test("an index that will not be cached is never serialized", async () => {
  const restore = asSurface({ referrer: "" });
  let serialized = 0;
  try {
    await persistSearchIndex(null, () => {
      serialized += 1;
      return "{}";
    }, WEB_CACHE_DOCUMENT_LIMIT + 1);

    assert.equal(
      serialized,
      0,
      "serializing is itself a stall; paying it to discard the result is the worst case",
    );
  } finally {
    restore();
  }
});

test("an index that will be cached is serialized exactly once", async () => {
  const restore = asSurface({ displayMode: "standalone" });
  let serialized = 0;
  try {
    // No IndexedDB in this process, so the write fails soft — what is asserted
    // is that the decision to serialize was taken.
    await persistSearchIndex(null, () => {
      serialized += 1;
      return "{}";
    }, 100);
    assert.equal(serialized, 1);
  } finally {
    restore();
  }
});
