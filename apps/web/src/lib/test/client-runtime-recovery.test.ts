/**
 * Both error boundaries read the platform and the reset warning from
 * `lib/client-runtime-recovery` (xhelp-29), so the two screens cannot drift.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAndroidApp, RESET_APP_DATA_CONFIRM } from "../client-runtime-recovery";

function withDocument(doc: unknown, run: () => void): void {
  const g = globalThis as { document?: unknown };
  const had = "document" in g;
  const prev = g.document;
  g.document = doc;
  try {
    run();
  } finally {
    if (had) g.document = prev;
    else delete g.document;
  }
}

test("isAndroidApp is false without a document (server render)", () => {
  withDocument(undefined, () => assert.equal(isAndroidApp(), false));
});

test("isAndroidApp is true only for an android-app:// referrer", () => {
  withDocument({ referrer: "android-app://org.weaveforge.app/" }, () => assert.equal(isAndroidApp(), true));
  withDocument({ referrer: "https://weaveforge.org/" }, () => assert.equal(isAndroidApp(), false));
  withDocument({ referrer: "" }, () => assert.equal(isAndroidApp(), false));
  withDocument({ referrer: "https://x/?r=android-app://a" }, () => assert.equal(isAndroidApp(), false));
});

test("isAndroidApp is false when reading the referrer throws", () => {
  const doc = {
    get referrer(): string {
      throw new Error("denied");
    },
  };
  withDocument(doc, () => assert.equal(isAndroidApp(), false));
});

test("the reset warning names what is lost and that it is final", () => {
  assert.equal(
    RESET_APP_DATA_CONFIRM,
    "Reset app data? Offline copies of your work on this device will be deleted. This cannot be undone.",
  );
});
