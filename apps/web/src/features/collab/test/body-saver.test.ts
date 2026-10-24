/**
 * The collaborative editor's body saves. Compaction deletes CRDT log rows once
 * `flush()` says the body is durable, so a `true` that is not backed by a
 * stored body loses text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { BodySaver } from "../application/body-saver";

function harness(opts: { fail?: (body: string) => boolean; delayMs?: number } = {}) {
  const saved: string[] = [];
  const errors: unknown[] = [];
  const releases: (() => void)[] = [];
  let hold = false;
  const saver = new BodySaver(
    {
      delayMs: opts.delayMs ?? 60_000,
      onError: (err) => errors.push(err),
      save: async (body) => {
        if (hold) await new Promise<void>((resolve) => releases.push(resolve));
        if (opts.fail?.(body)) throw new Error(`offline: ${body}`);
        saved.push(body);
      },
    },
    "stored",
  );
  saver.seeded("stored");
  return {
    saver,
    saved,
    errors,
    holdSaves: () => {
      hold = true;
    },
    release: () => {
      hold = false;
      for (const r of releases.splice(0)) r();
    },
  };
}

test("an edit is written on flush", async () => {
  const { saver, saved } = harness();
  saver.schedule("edited");
  assert.equal(await saver.flush(), true);
  assert.deepEqual(saved, ["edited"]);
});

test("the debounce writes the edit on its own", async () => {
  const { saver, saved } = harness({ delayMs: 1 });
  saver.schedule("edited");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(saved, ["edited"]);
});

test("nothing is saved before the document is seeded", async () => {
  const { saver, saved } = harness();
  saver.begin();
  saver.schedule("");
  saver.close("");
  assert.equal(await saver.flush(), true);
  assert.deepEqual(saved, []);
});

test("an edit reverted to the saved text is dropped, not saved later (33-01)", async () => {
  const { saver, saved } = harness();
  saver.schedule("typo");
  saver.schedule("stored");

  assert.equal(await saver.flush(), true);
  saver.close("stored");
  assert.equal(await saver.flush(), true);
  assert.deepEqual(saved, [], "the abandoned edit must not come back");
});

test("a failed save leaves the body dirty and flush reports it (33-02)", async () => {
  let offline = true;
  const { saver, saved } = harness({ fail: () => offline });
  saver.schedule("edited");

  assert.equal(await saver.flush(), false);
  assert.deepEqual(saved, []);

  offline = false;
  assert.equal(await saver.flush(), true, "the same body is retried");
  assert.deepEqual(saved, ["edited"]);
});

test("after a failed save the same text is still saved on close (33-02)", async () => {
  let offline = true;
  const { saver, saved } = harness({ fail: () => offline });
  saver.schedule("edited");
  assert.equal(await saver.flush(), false);

  offline = false;
  saver.close("edited");
  assert.equal(await saver.flush(), true);
  assert.deepEqual(saved, ["edited"]);
});

test("a later edit is not overwritten by restoring a failed one", async () => {
  const { saver, saved, holdSaves, release } = harness({ fail: (body) => body === "first" });
  saver.schedule("first");
  holdSaves();
  const failed = saver.flush();
  saver.schedule("second");
  release();
  assert.equal(await failed, false);

  assert.equal(await saver.flush(), true);
  assert.deepEqual(saved, ["second"]);
});

test("a rejected save on close is reported, and flush says the body is not durable (33-03)", async () => {
  const { saver, saved, errors } = harness({ fail: () => true });
  saver.schedule("edited");
  saver.close("edited");

  assert.equal(await saver.flush(), false, "compaction must not delete rows for an unsaved body");
  assert.deepEqual(saved, []);
  assert.equal(errors.length, 1, "the rejection is handled, not left unhandled");
});

test("close writes the body once, and flush waits for that write (33-03)", async () => {
  const { saver, saved, holdSaves, release } = harness();
  holdSaves();
  saver.schedule("edited");
  saver.close("edited");

  let settled = false;
  const flushed = saver.flush().then((ok) => {
    settled = true;
    return ok;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(settled, false, "flush must not report durable before the save lands");

  release();
  assert.equal(await flushed, true);
  assert.deepEqual(saved, ["edited"], "close and flush must not both save it");
});

test("flush while a debounced save is in flight waits for it", async () => {
  const { saver, holdSaves, release } = harness({ fail: () => true });
  holdSaves();
  saver.schedule("edited");
  const first = saver.flush();
  const second = saver.flush();
  release();
  assert.equal(await first, false);
  assert.equal(await second, false);
});

test("seeding with a new body makes that the saved text", async () => {
  const { saver, saved } = harness();
  saver.begin();
  saver.seeded("from the log");
  saver.schedule("from the log");
  saver.close("from the log");
  assert.equal(await saver.flush(), true);
  assert.deepEqual(saved, []);
});
