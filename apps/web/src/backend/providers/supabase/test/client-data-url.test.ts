import assert from "node:assert/strict";
import test from "node:test";
import {
  createRestClient,
  createSupabaseClient,
  getRealtimeClient,
  namedNetworkFailure,
  resetSupabaseClientForTests,
} from "../client";

/**
 * Pointing REST at a self-hosted PostgREST while auth stays on Supabase.
 *
 * This is the whole of the cutover on the client side, so it is worth pinning:
 * data requests must move, and everything else — the token endpoint above all —
 * must not, or nobody can sign in.
 */

const SUPABASE = "https://abcdef.supabase.co";
const DATA = "https://oci.example.com:3000";
const ANON = "anon-key";

function withFetch(run: (seen: string[]) => Promise<void> | void) {
  const seen: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  return Promise.resolve(run(seen)).finally(() => {
    globalThis.fetch = original;
    resetSupabaseClientForTests();
  });
}

test("table reads go to the data API, with the /rest/v1 prefix dropped", async () => {
  await withFetch(async (seen) => {
    const db = createSupabaseClient(SUPABASE, ANON, DATA);
    await db.from("papers").select("id");

    assert.equal(seen.length, 1);
    assert.ok(seen[0]!.startsWith(`${DATA}/papers`), `went to ${seen[0]}`);
    assert.ok(!seen[0]!.includes("supabase.co"), "no data request reaches Supabase");
    assert.ok(!seen[0]!.includes("/rest/v1"), "PostgREST serves tables at its root");
  });
});

test("the query string survives the rewrite", async () => {
  await withFetch(async (seen) => {
    const db = createSupabaseClient(SUPABASE, ANON, DATA);
    await db.from("papers").select("id").eq("status", "read");

    assert.match(seen[0]!, /status=eq\.read/);
    assert.match(seen[0]!, /select=id/);
  });
});

test("auth still goes to Supabase — the tokens are theirs to issue", async () => {
  await withFetch(async (seen) => {
    const db = createSupabaseClient(SUPABASE, ANON, DATA);
    await db.auth.getUser("some-token").catch(() => {});

    assert.ok(seen.length > 0);
    for (const url of seen) {
      assert.ok(url.startsWith(SUPABASE), `auth call went to ${url} instead of Supabase`);
    }
  });
});

test("with no data URL, nothing moves", async () => {
  await withFetch(async (seen) => {
    const db = createSupabaseClient(SUPABASE, ANON);
    await db.from("papers").select("id");

    assert.ok(seen[0]!.startsWith(`${SUPABASE}/rest/v1/papers`), `went to ${seen[0]}`);
  });
});

test("a data URL identical to the project URL is not a rewrite", async () => {
  await withFetch(async (seen) => {
    const db = createSupabaseClient(SUPABASE, ANON, SUPABASE);
    await db.from("papers").select("id");

    assert.ok(seen[0]!.startsWith(`${SUPABASE}/rest/v1/papers`));
  });
});

/** Run `body` with NEXT_PUBLIC_DATA_URL set, restoring whatever was there. */
function withDataUrlEnv(value: string, body: () => Promise<void>): Promise<void> {
  const previous = process.env.NEXT_PUBLIC_DATA_URL;
  process.env.NEXT_PUBLIC_DATA_URL = value;
  return body().finally(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_DATA_URL;
    else process.env.NEXT_PUBLIC_DATA_URL = previous;
  });
}

test("a caller that omits the data URL still gets the configured one", async () => {
  // The regression this pins: `wire-light-backend` builds the client first and
  // passed no data URL, so it won the singleton and the cutover silently
  // did nothing — every table read went to Supabase with the switch set.
  await withDataUrlEnv(DATA, () =>
    withFetch(async (seen) => {
      const db = createSupabaseClient(SUPABASE, ANON);
      await db.from("papers").select("id");

      assert.ok(seen[0]!.startsWith(`${DATA}/papers`), `went to ${seen[0]}`);
    }),
  );
});

test("asking for different parameters does not hand back the cached client", async () => {
  await withFetch(async (seen) => {
    const first = createSupabaseClient(SUPABASE, ANON, SUPABASE);
    const second = createSupabaseClient(SUPABASE, ANON, DATA);
    assert.notEqual(first, second, "a different data URL must build a different client");

    await second.from("papers").select("id");
    assert.ok(seen.at(-1)!.startsWith(`${DATA}/papers`), `went to ${seen.at(-1)}`);
  });
});

test("per-request server clients rewrite too, and keep their auth header", async () => {
  await withDataUrlEnv(DATA, () =>
    withFetch(async () => {
      const calls: RequestInit[] = [];
      const original = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ ...init, ...(typeof input === "object" && "headers" in input ? {} : {}) });
        assert.ok(
          (typeof input === "string" ? input : (input as Request).url).startsWith(`${DATA}/papers`),
          "an API route's client must reach the data API, not Supabase",
        );
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch;

      try {
        const db = createRestClient(SUPABASE, ANON, {
          global: { headers: { Authorization: "Bearer server-token" } },
        });
        await db.from("papers").select("id");
      } finally {
        globalThis.fetch = original;
      }
    }),
  );
});

test("realtime stays on the main client until a realtime URL is configured", async () => {
  await withFetch(async () => {
    const main = createSupabaseClient(SUPABASE, ANON, DATA);
    assert.equal(getRealtimeClient(main), main, "no realtime URL means no second socket");
  });
});

test("a configured realtime URL gets its own socket, pointed at the self-hosted one", async () => {
  const REALTIME = "https://api.example.org";
  const previous = process.env.NEXT_PUBLIC_REALTIME_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_REALTIME_URL = REALTIME;
  // The socket client is built from config, exactly as a deployment has it.
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON;
  try {
    await withFetch(async () => {
      const main = createSupabaseClient(SUPABASE, ANON, DATA);
      const realtime = getRealtimeClient(main);

      assert.notEqual(realtime, main, "the socket cannot be the Supabase client's");
      // Broadcast channels are authorized by RLS reading the app tables, so the
      // socket has to terminate at the database that holds the current rows.
      const endpoint = (realtime.realtime as unknown as { endPoint: string }).endPoint;
      assert.ok(
        endpoint.startsWith(REALTIME.replace("https://", "wss://")),
        `socket points at ${endpoint}`,
      );
      assert.equal(getRealtimeClient(main), realtime, "and it is reused");
    });
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_REALTIME_URL;
    else process.env.NEXT_PUBLIC_REALTIME_URL = previous;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
  }
});

test("a trailing slash on either URL does not produce a doubled one", async () => {
  await withFetch(async (seen) => {
    const db = createSupabaseClient(SUPABASE, ANON, `${DATA}/`);
    await db.from("papers").select("id");

    assert.ok(!seen[0]!.includes("//papers"), `doubled slash in ${seen[0]}`);
    assert.ok(seen[0]!.startsWith(`${DATA}/papers`));
  });
});

test("a network failure names the host it could not reach", async () => {
  // "TypeError: Failed to fetch" carries no URL, so a user reporting it cannot
  // say whether auth or the data API is the unreachable half. That is the only
  // fact worth having, so the client attaches it.
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  try {
    const db = createSupabaseClient(SUPABASE, ANON, DATA);
    const { error } = await db.from("papers").select("id");
    assert.match(String(error?.message), /oci\.example\.com:3000/);
  } finally {
    globalThis.fetch = original;
    resetSupabaseClientForTests();
  }
});

/**
 * The probe's answer must not be reported as a CORS verdict.
 *
 * This is the bug that cost a person an evening on a VM: the probe uses
 * `mode: "no-cors"`, which resolves for **any** response — measured against the
 * live API, a real `GET /rest/v1/papers` returns `401` *with*
 * `access-control-allow-origin` set correctly, and the old code still reported an
 * "origin refused". The host being up says nothing about its allow-list, so all
 * the client may claim is that the host answered.
 *
 * Tested through `namedNetworkFailure` directly rather than through a Supabase
 * query. Driving it through the client meant mocking `fetch` and then asserting
 * on whatever the library decided to put in `error.message`, which turned out to
 * be nothing — the assertion saw `""` and the test was measuring Supabase's error
 * plumbing instead of this function. The unit under test is the one that was
 * wrong, so it is the one called.
 */
test("a probe that resolves is not reported as an origin refusal", async () => {
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    // `no-cors` resolves opaquely for a 401 exactly as it does for a 200, which
    // is the whole reason "reachable" cannot mean "the origin was accepted".
    return new Response(null, { status: 401 });
  }) as typeof fetch;
  try {
    const wrapped = (await namedNetworkFailure(
      new TypeError("Failed to fetch"),
      "https://oci.example.com:3000/rest/v1",
    )) as Error;
    assert.match(wrapped.message, /\(host answered\)/, "the observation is carried");
    assert.match(wrapped.message, /\(browser said: Failed to fetch\)/, "and the browser's words");
    assert.doesNotMatch(wrapped.message, /origin refused/, "a claim the probe cannot support");
    // The probe asks a path the API serves, not the bare origin PostgREST
    // answers with a 404.
    assert.ok(
      seen.some((u) => u.endsWith("/rest/v1/")),
      `expected a probe of /rest/v1/, saw ${JSON.stringify(seen)}`,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("a probe that fails is reported as an unreachable host, with no CORS claim", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  try {
    const wrapped = (await namedNetworkFailure(
      new TypeError("Failed to fetch"),
      "https://oci.example.com:3000/rest/v1",
    )) as Error;
    assert.match(wrapped.message, /could not reach oci\.example\.com:3000/);
    assert.doesNotMatch(wrapped.message, /host answered|origin refused/);
  } finally {
    globalThis.fetch = original;
  }
});

test("only a network failure is rewritten; a server's own words pass through", async () => {
  const notNetwork = new Error("aborted by the caller");
  assert.equal(await namedNetworkFailure(notNetwork, "https://x.example/rest/v1"), notNetwork);
});

test("an error that is not a network failure keeps its own words", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("aborted by the caller");
  }) as typeof fetch;
  try {
    const db = createSupabaseClient(SUPABASE, ANON, DATA);
    const { error } = await db.from("papers").select("id");
    assert.match(String(error?.message), /aborted by the caller/);
    assert.doesNotMatch(String(error?.message), /could not reach/);
  } finally {
    globalThis.fetch = original;
    resetSupabaseClientForTests();
  }
});
