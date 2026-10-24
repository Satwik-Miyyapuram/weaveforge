/**
 * The realtime socket client's lifecycle (B59).
 *
 * - 09-12: replacing or resetting the cached client closes the old socket, so
 *   a config change does not leave a second socket reconnecting forever.
 * - 09-13: a failed token prime is logged, not left as an unhandled rejection.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getRealtimeClient, resetDataClientForTests } from "../client";

type Log = { level: string; source: string; message: string; detail?: string };

const SUPABASE = "https://abcdef.supabase.co";
const REALTIME = "https://api.example.org";

function mainClient(getSession: () => Promise<unknown>): SupabaseClient {
  return { auth: { getSession } } as unknown as SupabaseClient;
}

const signedOut = () => mainClient(async () => ({ data: { session: null } }));

async function withRealtimeEnv(run: (logs: Log[], unhandled: unknown[]) => Promise<void>): Promise<void> {
  const keys = ["NEXT_PUBLIC_REALTIME_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_URL"] as const;
  const previous = keys.map((k) => process.env[k]);
  process.env.NEXT_PUBLIC_REALTIME_URL = REALTIME;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-1";
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
  const logs: Log[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (entry: Log) => void logs.push(entry) },
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    await run(logs, unhandled);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    (globalThis as { window?: unknown }).window = originalWindow;
    resetDataClientForTests();
    keys.forEach((k, i) => {
      if (previous[i] === undefined) delete process.env[k];
      else process.env[k] = previous[i];
    });
  }
}

function spyDisconnect(client: SupabaseClient): () => number {
  let calls = 0;
  const socket = client.realtime as unknown as { disconnect: (...a: unknown[]) => unknown };
  const original = socket.disconnect.bind(socket);
  socket.disconnect = (...a: unknown[]) => {
    calls += 1;
    return original(...a);
  };
  return () => calls;
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test("a changed realtime config closes the old socket before building a new one (09-12)", async () => {
  await withRealtimeEnv(async () => {
    const main = signedOut();
    const first = getRealtimeClient(main);
    const disconnects = spyDisconnect(first);

    assert.equal(getRealtimeClient(main), first, "same config reuses the socket");
    assert.equal(disconnects(), 0, "and does not close it");

    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-2";
    const second = getRealtimeClient(main);
    assert.notEqual(second, first);
    assert.equal(disconnects(), 1, "the replaced socket is closed");
    await settle();
  });
});

test("reset closes the cached socket (09-12)", async () => {
  await withRealtimeEnv(async () => {
    const first = getRealtimeClient(signedOut());
    const disconnects = spyDisconnect(first);
    resetDataClientForTests();
    assert.equal(disconnects(), 1);
    resetDataClientForTests();
    assert.equal(disconnects(), 1, "a second reset has nothing left to close");
    await settle();
  });
});

test("reset with no realtime client built is a no-op", () => {
  assert.doesNotThrow(() => resetDataClientForTests());
});

test("a failed token prime is logged, not left unhandled (09-13)", async () => {
  await withRealtimeEnv(async (logs, unhandled) => {
    // realtime-js swallows a failing `accessToken` itself, so make `setAuth`
    // reject the way any other failure inside it would.
    const proto = Object.getPrototypeOf(getRealtimeClient(signedOut()).realtime) as {
      setAuth: (...a: unknown[]) => Promise<void>;
    };
    resetDataClientForTests();
    const original = proto.setAuth;
    proto.setAuth = () => Promise.reject(new Error("session read failed"));
    try {
      getRealtimeClient(signedOut());
      await settle();
    } finally {
      proto.setAuth = original;
    }
    assert.deepEqual(unhandled, []);
    const auth = logs.filter((l) => l.source === "realtime");
    assert.equal(auth.length, 1);
    assert.equal(auth[0]!.level, "warn");
    assert.match(auth[0]!.detail ?? "", /session read failed/);
  });
});

test("a successful token prime logs nothing", async () => {
  await withRealtimeEnv(async (logs, unhandled) => {
    getRealtimeClient(signedOut());
    await settle();
    assert.deepEqual(unhandled, []);
    assert.deepEqual(logs, []);
  });
});
