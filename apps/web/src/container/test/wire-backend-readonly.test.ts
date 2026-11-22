import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { loadTestCore } from "@/lib/test/load-test-core";
import { wireBackend } from "../parts";
import { ORG_SERVER_WRITE_TABLES } from "../org-server-allowlist";
import { READ_ONLY_KEYS } from "../read-only-repositories";

before(loadTestCore);

/** A local PostgREST stand-in that records every request it receives. */
const received: { method: string; table: string }[] = [];
const server: Server = createServer((req: IncomingMessage, res) => {
  const path = (req.url ?? "").split("?")[0] ?? "";
  // An rpc call names a function, not a table; the guard judges rpcs by their own rule, so they are not counted here.
  const table = path.includes("/rpc/") ? "" : (path.split("/").filter(Boolean).pop() ?? "");
  received.push({ method: req.method ?? "", table });
  res.setHeader("content-type", "application/json");
  res.end("[]");
});
before(() => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve())));
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function config(): never {
  const { port } = server.address() as AddressInfo;
  return { provider: "postgrest", supabaseUrl: `http://127.0.0.1:${port}`, supabaseAnonKey: "anon" } as never;
}

test("the desktop read-only fallback sends no personal-table write to the server, whichever repository is called", async () => {
  const backend = wireBackend(config(), { projectId: null }, () => null, {
    onDesktop: true,
    migration: "unavailable",
  } as never) as unknown as Record<string, Record<string, unknown>>;
  const calls: Promise<unknown>[] = [];
  for (const key of READ_ONLY_KEYS) {
    const repo = backend[key];
    if (!repo || typeof repo !== "object") continue;
    let proto: object | null = repo;
    while (proto && proto !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === "constructor") continue;
        const fn: unknown = (repo as Record<string, unknown>)[name];
        if (typeof fn !== "function") continue;
        try {
          const out = (fn as (...a: unknown[]) => unknown).call(repo);
          if (out && typeof (out as Promise<unknown>).then === "function") calls.push(out as Promise<unknown>);
        } catch {
          /* a refused call throws synchronously; that is the expected outcome */
        }
      }
      proto = Object.getPrototypeOf(proto);
    }
  }
  await Promise.race([Promise.allSettled(calls), new Promise((resolve) => setTimeout(resolve, 1500))]);
  const personalWrites = received.filter(
    (r) =>
      r.table !== "" &&
      r.method !== "GET" &&
      r.method !== "HEAD" &&
      !(ORG_SERVER_WRITE_TABLES as readonly string[]).includes(r.table),
  );
  assert.deepEqual(personalWrites, [], "no personal-table write reached the server");
});
