import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { routedClient } from "../local-first";
import { localFirstAccount, setLocalFirstAccount } from "../local-first-marker";

/** A client that says which end a call reached. */
function end(name: string) {
  return {
    from: (table: string) => `${name}:${table}`,
    rpc(fn: string) {
      return `${name}:${fn}:${this === client.server ? "bound" : "unbound"}`;
    },
    auth: { name },
  };
}

const client = { server: end("server"), local: end("local") };

function routed(): SupabaseClient {
  return routedClient(
    client.local as unknown as SupabaseClient,
    client.server as unknown as SupabaseClient,
    new Set(["projects"]),
  );
}

describe("the local-first client", () => {
  it("reads and writes synced tables on this computer", () => {
    assert.equal(routed().from("projects") as unknown, "local:projects");
  });

  it("sends tables that do not sync to the server", () => {
    assert.equal(routed().from("project_shares") as unknown, "server:project_shares");
  });

  it("sends RPCs and auth to the server, bound to it", () => {
    const db = routed() as unknown as { rpc: (fn: string) => string; auth: { name: string } };
    assert.equal(db.rpc("sync_changes"), "server:sync_changes:bound");
    assert.equal(db.auth.name, "server");
  });
});

describe("metric reads on the local-first client", () => {
  function ends(local: unknown[], server: unknown[] | Error) {
    const reply = (r: unknown[] | Error) => async () =>
      r instanceof Error ? { data: null, error: r } : { data: r, error: null };
    return routedClient(
      { rpc: reply(local) } as unknown as SupabaseClient,
      { rpc: reply(server) } as unknown as SupabaseClient,
    );
  }

  it("draws a run whose points are only on this computer", async () => {
    const { data } = await ends([{ step: 1 }], []).rpc("metric_history", {});
    assert.deepEqual(data, [{ step: 1 }]);
  });

  it("falls back to the server when this computer has none", async () => {
    const { data } = await ends([], [{ step: 2 }]).rpc("metric_history", {});
    assert.deepEqual(data, [{ step: 2 }]);
  });

  it("joins activity from both ends and survives one failing", async () => {
    const both = await ends([{ id: "a" }], [{ id: "b" }]).rpc("latest_metric_activity", {});
    assert.deepEqual(both.data, [{ id: "a" }, { id: "b" }]);
    const one = await ends([{ id: "a" }], new Error("offline")).rpc("latest_metric_activity", {});
    assert.deepEqual(one.data, [{ id: "a" }]);
  });
});

describe("the local-first marker", () => {
  const store = new Map<string, string>();
  const g = globalThis as { window?: unknown };

  function withStorage() {
    g.window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
  }

  afterEach(() => {
    store.clear();
    delete g.window;
  });

  it("is absent where there is no window", () => {
    assert.equal(localFirstAccount(), null);
  });

  it("remembers the account and forgets it on sign-out", () => {
    withStorage();
    setLocalFirstAccount({ id: "a1", email: "a@example.com" });
    assert.deepEqual(localFirstAccount(), { id: "a1", email: "a@example.com" });
    setLocalFirstAccount(null);
    assert.equal(localFirstAccount(), null);
  });

  it("ignores a marker it cannot read", () => {
    withStorage();
    store.set("weaveforge.local-first", "{not json");
    assert.equal(localFirstAccount(), null);
  });
});
