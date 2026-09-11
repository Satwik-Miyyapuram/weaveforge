import assert from "node:assert/strict";
import test from "node:test";

import { RECHECK_MS, startAutoUpdate, type AutoUpdateOptions, type Updater } from "../src/auto-update";

/**
 * The consent question, and the one answer that used to be assumed.
 *
 * The updater used to download silently and install on quit, on a build that is
 * not code-signed — so the only thing between a forged release and code running
 * on the reader's machine was a hash served by the same release. What is tested
 * here is that the install is now something the reader asks for, and that the
 * download is still quiet and automatic, because that part was never the
 * problem.
 *
 * The dialog is injected: a test cannot put a window on a screen, and the
 * decision — ask, then install only on yes — is the part worth asserting.
 */

interface FakeUpdater extends Updater {
  /** Every handler the module registered, by event name. */
  fired(event: "update-downloaded" | "error", ...args: unknown[]): void;
  installed: number;
  checks: number;
}

function fakeUpdater(): FakeUpdater {
  const handlers = new Map<string, ((...args: never[]) => void)[]>();
  return {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    installed: 0,
    checks: 0,
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler as (...args: never[]) => void]);
    },
    fired(event, ...args) {
      for (const handler of handlers.get(event) ?? []) handler(...(args as never[]));
    },
    quitAndInstall() {
      this.installed += 1;
    },
    async checkForUpdates() {
      this.checks += 1;
      return null;
    },
  };
}

/** The options every case here shares, minus the answer it is testing. */
function options(updater: Updater, overrides: Partial<AutoUpdateOptions> = {}): AutoUpdateOptions {
  return {
    updater,
    window: () => null,
    enabled: true,
    // Nothing is scheduled: a real interval would keep the test process alive,
    // and the recheck schedule is not what is being asked about.
    schedule: () => {},
    ...overrides,
  };
}

test("auto update: a downloaded update must never install itself on quit", () => {
  const updater = fakeUpdater();

  assert.equal(startAutoUpdate(options(updater)), true);

  // The finding, in one assertion. `electron-updater` installs a downloaded
  // update during shutdown when this is true, with no dialog and no window.
  assert.equal(updater.autoInstallOnAppQuit, false);
  // Downloading in the background is kept: it is what makes "Restart now" a
  // few seconds rather than a download.
  assert.equal(updater.autoDownload, true);
});

test("auto update: the reader is asked, and 'Restart now' is what installs it", async () => {
  const updater = fakeUpdater();
  const asked: string[] = [];

  startAutoUpdate(
    options(updater, {
      ask: async (info) => {
        asked.push(info.version);
        return true;
      },
    }),
  );
  updater.fired("update-downloaded", { version: "9.9.9" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(asked, ["9.9.9"]);
  assert.equal(updater.installed, 1);
});

test("auto update: 'Later' leaves the update downloaded and not installed", async () => {
  const updater = fakeUpdater();
  let asked = 0;

  startAutoUpdate(
    options(updater, {
      ask: async () => {
        asked += 1;
        return false;
      },
    }),
  );
  updater.fired("update-downloaded", { version: "9.9.9" });
  updater.fired("update-downloaded", { version: "9.9.9" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(asked, 2, "a dismissal must not be remembered as consent either way");
  assert.equal(updater.installed, 0, "nothing installs without an answer of yes");
});

test("auto update: a question that fails is a no, not a crash", async () => {
  const updater = fakeUpdater();

  startAutoUpdate(
    options(updater, {
      ask: async () => {
        throw new Error("no window");
      },
    }),
  );
  updater.fired("update-downloaded", { version: "9.9.9" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(updater.installed, 0);
});

test("auto update: checking happens at once and again on the schedule", () => {
  const updater = fakeUpdater();
  const scheduled: number[] = [];

  startAutoUpdate(
    options(updater, {
      schedule: (_fn, ms) => {
        scheduled.push(ms);
      },
    }),
  );

  assert.equal(updater.checks, 1, "the first look is on start, not six hours later");
  assert.deepEqual(scheduled, [RECHECK_MS]);
});

test("auto update: an unreachable feed is swallowed rather than shown", async () => {
  const updater = fakeUpdater();
  updater.checkForUpdates = async () => {
    throw new Error("ENOTFOUND");
  };

  assert.equal(startAutoUpdate(options(updater)), true);
  await new Promise((resolve) => setImmediate(resolve));

  // The error channel is subscribed to and does nothing: an app on a train must
  // not open a dialog about it.
  assert.doesNotThrow(() => updater.fired("error", new Error("ENOTFOUND")));
});

test("auto update: disabled means nothing is registered", () => {
  const updater = fakeUpdater();

  assert.equal(startAutoUpdate(options(updater, { enabled: false })), false);
  assert.equal(updater.checks, 0);
  // Untouched: a development copy must not reconfigure an updater it never runs.
  assert.equal(updater.autoInstallOnAppQuit, true);
});
