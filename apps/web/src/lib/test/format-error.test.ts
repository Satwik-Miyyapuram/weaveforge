import { test } from "node:test";
import assert from "node:assert/strict";
import { formatError, formatErrorForResponse, readJsonBody } from "../format-error";

test("formatError: null/undefined -> generic message", () => {
  assert.equal(formatError(null), "Something went wrong.");
  assert.equal(formatError(undefined), "Something went wrong.");
});

test("formatError: strings pass through, junk is replaced", () => {
  assert.equal(formatError("  boom  "), "boom");
  assert.equal(formatError("[object Object]"), "Something went wrong.");
  assert.equal(formatError("   "), "Something went wrong.");
});

test("formatError: Error uses its message", () => {
  assert.equal(formatError(new Error("kaboom")), "kaboom");
});

test("formatError: plain object with message", () => {
  assert.equal(formatError({ message: "nope" }), "nope");
});

test("formatError: unwraps a nested error field", () => {
  assert.equal(formatError({ error: { message: "inner failure" } }), "inner failure");
});

test("formatError: joins PostgREST details/hint/code when there is no message", () => {
  // A string `message` short-circuits; the join path is for message-less rows.
  const text = formatError({ details: "row 3", hint: "check it", code: "P0001" });
  assert.equal(text, "row 3 — check it — (P0001)");
});

test("formatError: appends the api_tokens migration hint", () => {
  const byText = formatError({ details: "relation api_tokens does not exist", code: "42P01" });
  assert.match(byText, /Apply the schema migrations \(npm run migrate:schema; migration 0061\)/);
  const byCode = formatError({ details: "schema cache miss", code: "PGRST205" });
  assert.match(byCode, /migration 0061/);
});

test("formatError: falls back to JSON for opaque objects", () => {
  assert.equal(formatError({ weird: 1 }), JSON.stringify({ weird: 1 }));
});

test("readJsonBody: empty body -> {}", async () => {
  assert.deepEqual(await readJsonBody(new Response("")), {});
});

test("readJsonBody: object body parsed as-is", async () => {
  assert.deepEqual(await readJsonBody(new Response(JSON.stringify({ a: 1 }))), { a: 1 });
});

test("readJsonBody: array body wrapped under data", async () => {
  assert.deepEqual(await readJsonBody(new Response(JSON.stringify([1, 2]))), { data: [1, 2] });
});

test("readJsonBody: invalid JSON -> error field", async () => {
  const out = await readJsonBody(new Response("not json", { status: 500 }));
  assert.match(String(out.error), /not json/);
});

test("a network failure is explained instead of shown as \"Failed to fetch\"", () => {
  // Every browser words it differently and none of them words it usefully.
  for (const raw of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]) {
    const message = formatError(new TypeError(raw));
    assert.match(message, /Could not reach the server/);
    assert.doesNotMatch(message, /Failed to fetch|NetworkError|Load failed/);
  }
});

test("a chunk that went missing under a running tab says to reload", () => {
  const message = formatError(
    new TypeError("Failed to fetch dynamically imported module: https://example.test/_next/static/chunks/x.js"),
  );
  assert.match(message, /reload the page/);
});

test("a server error keeps its own words", () => {
  assert.equal(formatError(new Error("permission denied for table user_settings")), "permission denied for table user_settings");
});

test("the host the client named survives into the reader's wording", () => {
  assert.match(
    formatError(new TypeError("Failed to fetch (could not reach api.weaveforge.org)")),
    /Could not reach api\.weaveforge\.org\./,
  );
});

test("a failed fetch handed back as a plain object still gets the network wording", () => {
  assert.match(
    formatError({ message: "TypeError: Failed to fetch (could not reach api.weaveforge.org)" }),
    /check your connection/,
  );
});

test("a network failure names this origin, because a CORS refusal looks identical", () => {
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { location: { origin: "https://weaveforge-preview-abc.vercel.app" } };
  try {
    const message = formatError(
      new TypeError("Failed to fetch (could not reach api.weaveforge.org)"),
    );
    assert.match(message, /Could not reach api\.weaveforge\.org\./);
    assert.match(message, /weaveforge-preview-abc\.vercel\.app/, "the origin must be named");
    assert.match(message, /CORS allow-list/, "and the likely cause stated");
  } finally {
    if (original === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = original;
  }
});

test("a host that answered does not get its allow-list blamed", () => {
  /*
   * This test used to assert the opposite, and it was pinning a bug.
   *
   * The old marker was `(origin refused by <host>)` and this test required the
   * message to name `CORS_ALLOWED_ORIGINS` as the fix. But the probe behind that
   * marker uses `mode: "no-cors"`, which resolves for any response at all — 200,
   * 401, 404 — so it proves the host is up and nothing more. A host being up says
   * nothing about its allow-list, and the conclusion did not follow.
   *
   * Measured cost: with the live API answering `access-control-allow-origin`
   * correctly on real responses and `204` on preflights for both origins, this
   * message sent a person to edit a Caddyfile that was already right.
   *
   * What is asserted now: the message reports the observation (the host is up),
   * carries the browser's own words, and makes no claim it cannot support.
   */
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { location: { origin: "http://localhost:4100" } };
  try {
    const message = formatError(
      new TypeError(
        "Failed to fetch (could not reach api.weaveforge.org) (host answered) (browser said: Failed to fetch)",
      ),
    );
    assert.match(message, /answered a reachability check, so it is running/);
    assert.match(message, /from http:\/\/localhost:4100/, "the origin is named");
    assert.match(message, /Failed to fetch/, "the browser's own words are carried");
    assert.doesNotMatch(message, /CORS_ALLOWED_ORIGINS/, "no server-side claim it cannot support");
    assert.doesNotMatch(message, /check your connection/, "and the connection advice dropped");
  } finally {
    if (original === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = original;
  }
});

test("a host that did not answer still gets the connection advice", () => {
  // The other half, and the one the old code got right: a probe that failed means
  // the host is genuinely unreachable, so the reader is told to check the network
  // rather than sent looking for a server-side list.
  const message = formatError(
    new TypeError("Failed to fetch (could not reach api.weaveforge.org)"),
  );
  assert.match(message, /Could not reach api\.weaveforge\.org\./);
  assert.match(message, /check your connection/);
  assert.doesNotMatch(message, /CORS_ALLOWED_ORIGINS/);
});

// ---------------------------------------------------------------- the wire form
//
// `formatError` is the display formatter: it is what the UI shows the person
// whose own data is in the message. `formatErrorForResponse` is what a route
// may put in a response body. The two are tested apart because the difference
// between them is the whole point.

test("formatErrorForResponse: a database message never reaches the client", () => {
  const raw = {
    message: 'duplicate key value violates unique constraint "api_tokens_token_hash_idx"',
    details: "Key (token_hash)=(\\xdeadbeef) already exists.",
    code: "23505",
  };
  const safe = formatErrorForResponse(raw, "test");
  assert.doesNotMatch(safe, /api_tokens/);
  assert.doesNotMatch(safe, /token_hash/);
  assert.doesNotMatch(safe, /deadbeef/);
  // The code is kept: it is the one useful token for a caller debugging an SDK
  // call, and it names nothing.
  assert.match(safe, /already in use/);
  assert.match(safe, /23505/);
});

test("formatErrorForResponse: an RLS refusal reads as a permission problem", () => {
  const safe = formatErrorForResponse({
    message: 'new row violates row-level security policy for table "experiment_metric_points"',
    code: "42501",
  });
  assert.doesNotMatch(safe, /experiment_metric_points/);
  assert.match(safe, /permission/i);
});

test("formatErrorForResponse: each caller-fault SQLSTATE gets its own wording", () => {
  assert.match(formatErrorForResponse({ code: "23503" }), /no longer exists/);
  assert.match(formatErrorForResponse({ code: "23514" }), /not accepted/);
  assert.match(formatErrorForResponse({ code: "22P02" }), /wrong format/);
  assert.match(formatErrorForResponse({ code: "23502" }), /required field/);
});

test("formatErrorForResponse: a missing migration is surfaced, without the table name", () => {
  // The one case where the generic wording is useless to the only person who can
  // act on it. The existing `message — details — hint` form named `api_tokens`;
  // this says the same useful thing and names nothing.
  for (const code of ["42P01", "PGRST205"]) {
    const safe = formatErrorForResponse({ message: 'relation "api_tokens" does not exist', code });
    assert.match(safe, /migration/i);
    assert.match(safe, /npm run migrate:schema/);
    assert.doesNotMatch(safe, /api_tokens/, "the hint must not carry the table name");
  }
});

test("formatErrorForResponse: anything not from the database passes through", () => {
  // This is the half the SDK needs. Hiding a validation message would make the
  // API undebuggable, and these are written for a reader already.
  assert.equal(
    formatErrorForResponse(new Error("A professor cannot create an admin account.")),
    "A professor cannot create an admin account.",
  );
  assert.equal(
    formatErrorForResponse(new Error("Server is missing SUPABASE_JWT_SECRET for API token auth.")),
    "Server is missing SUPABASE_JWT_SECRET for API token auth.",
  );
  assert.match(
    formatErrorForResponse(new Error("Failed to fetch")),
    /Could not reach the server/,
  );
});

test("formatErrorForResponse: a Node error code is not mistaken for a SQLSTATE", () => {
  // `ENOENT` is five characters and could look like a code. Classifying it as a
  // database error would hide a filesystem message behind "Something went wrong
  // on the server."
  const message = "ENOENT: no such file or directory, open '/var/data/x'";
  assert.equal(formatErrorForResponse(new Error(message)), message);
  assert.equal(formatErrorForResponse({ message: "connect ECONNREFUSED", code: "ECONNREFUSED" }), "connect ECONNREFUSED");
});

test("formatErrorForResponse: an unknown database code is generic but still coded", () => {
  // `XX000` is `internal_error` in PostgreSQL, and its class is *letters* — the
  // reason the class is looked up in a list rather than matched as two digits. A
  // digits-only test would let this one through unsanitised.
  for (const code of ["XX000", "P0001", "HV000", "0A000"]) {
    const safe = formatErrorForResponse({ message: "internal detail nobody should see", code });
    assert.doesNotMatch(safe, /internal detail/, code);
    assert.match(safe, /Something went wrong on the server/, code);
    assert.match(safe, new RegExp(code), code);
  }
});

test("formatErrorForResponse: Node errno codes are five letters too, and are not SQLSTATEs", () => {
  // The two are the same length and the same case; only the class distinguishes
  // them, and no Node code has a PostgreSQL class prefix.
  for (const code of ["EPERM", "EBADF", "ENXIO", "EPIPE", "EROFS"]) {
    const message = `${code}: an operating-system message that is not ours to hide`;
    assert.equal(
      formatErrorForResponse({ message, code }),
      message,
      `${code} is a filesystem code, not a database one`,
    );
  }
});


test("formatError: a missing database function says the server needs its migrations", () => {
  const message = formatError({
    code: "PGRST202",
    message: "Could not find the function public.metric_history(p_experiment_id, p_max_points, p_metric) in the schema cache",
    details: null,
    hint: null,
  });
  assert.match(message, /older than this version of the app/);
  assert.match(message, /no metric_history function/);
  assert.doesNotMatch(message, /\[object Object\]/);
});
