import assert from "node:assert/strict";
import test from "node:test";

import { ProjectLwwInvalidator } from "@/lib/cache/parts-1";
import { watchProjectChannel } from "../project-watch";

/**
 * Files mode keeps personal data on the device. A project realtime channel is a
 * network connection to the hosted realtime endpoint, so files mode must open none.
 */

function recordingDb() {
  const opened: string[] = [];
  const channel = (topic: string) => {
    const handle = {
      on: () => handle,
      subscribe: () => {
        opened.push(topic);
        return handle;
      },
      unsubscribe: async () => "ok",
      send: async () => "ok",
    };
    return handle;
  };
  return { opened, db: { channel, realtime: { setAuth: async () => undefined } } as never };
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

test("files mode opens zero realtime channels for the project", async () => {
  const { opened, db } = recordingDb();
  watchProjectChannel(new ProjectLwwInvalidator(), { db, filesMode: true }, "p1");
  await settle();
  assert.deepEqual(opened, []);
});

test("a server-backed container still opens the project channel", async () => {
  const { opened, db } = recordingDb();
  watchProjectChannel(new ProjectLwwInvalidator(), { db }, "p1");
  await settle();
  assert.deepEqual(opened, ["proj:p1"]);
});
