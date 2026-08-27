import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { LOCAL_API_HOST, LOCAL_API_PORT, startLocalApi, type LocalApi } from "../src/local-api-server";
import type { VaultSession } from "../src/vault-handlers";

const TOKEN = "test-token";
const session = {} as VaultSession;

/** One request, answered with its status — `fetch` hides an early reply. */
function send(options: { path: string; method?: string; body?: Buffer }): Promise<number | string> {
  return new Promise((resolve) => {
    const body = options.body;
    const req = http.request(
      {
        host: LOCAL_API_HOST,
        port: LOCAL_API_PORT,
        path: options.path,
        method: options.method ?? "GET",
        // A socket of its own per request, as a fresh client would have.
        agent: false,
        headers: {
          authorization: `Bearer ${TOKEN}`,
          ...(body ? { "content-type": "application/json", "content-length": body.length } : {}),
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", (error) => resolve(`threw: ${error.message}`));
    setTimeout(() => resolve("no response"), 8000).unref();
    if (!body) return req.end();
    // Sent in two pieces so the refusal happens mid-upload, which is the case
    // that used to reset the connection or wedge the server.
    req.write(body.subarray(0, body.length >> 1));
    setTimeout(() => req.end(body.subarray(body.length >> 1)), 100).unref();
  });
}

test("a body past the limit is refused, and the next request is still served", async (t) => {
  let api: LocalApi;
  try {
    api = await startLocalApi(session, () => TOKEN, async () => ({ ok: true, value: [] }));
  } catch {
    // Something is already on the port — usually the installed app.
    t.skip(`port ${LOCAL_API_PORT} is busy`);
    return;
  }
  try {
    assert.equal(await send({ path: "/api/sdk/whoami" }), 200);
    assert.equal(
      await send({ path: "/api/sdk/metrics", method: "POST", body: Buffer.alloc(9 * 1024 * 1024, "x") }),
      413,
    );
    // The one that used to time out: a new connection after the refusal.
    assert.equal(await send({ path: "/api/sdk/whoami" }), 200);
  } finally {
    await api.close();
  }
});
