import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkshopSession,
  deleteWorkshopSession,
  loadWorkshopSessionCookies,
  type WorkshopSessionStore,
} from "../infrastructure/overleaf-workshop-session";

test.before(() => { process.env.OVERLEAF_CREDENTIAL_KEY = "test-only-overleaf-server-key"; });

const COOKIE = "overleaf_session2=secret-cookie-value";

function memoryStore(): WorkshopSessionStore & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  let next = 0;
  return {
    rows,
    async save(ciphertext) { const id = `s${++next}`; rows.set(id, ciphertext); return id; },
    async loadCiphertext(id) { return rows.get(id) ?? null; },
    async remove(id) { rows.delete(id); },
  };
}

const okLogin = { cookiesLogin: async () => ({ type: "success" as const, identity: { csrfToken: "t", cookies: COOKIE } }) };
const badLogin = { cookiesLogin: async () => ({ type: "error" as const, message: "Failed to get User ID." }) };

test("a verified cookie is stored only as ciphertext and can be loaded back", async () => {
  const store = memoryStore();
  const created = await createWorkshopSession(store, COOKIE, okLogin);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const stored = [...store.rows.values()].join("");
  assert.doesNotMatch(stored, /secret-cookie-value/);
  assert.equal(await loadWorkshopSessionCookies(store, created.sessionId), COOKIE);
});

test("a rejected cookie stores nothing", async () => {
  const store = memoryStore();
  const created = await createWorkshopSession(store, "expired=1", badLogin);
  assert.deepEqual(created, { ok: false, message: "Failed to get User ID." });
  assert.equal(store.rows.size, 0);
});

test("a network failure during sign-in stores nothing and surfaces the error", async () => {
  const store = memoryStore();
  const down = { cookiesLogin: async () => { throw new Error("ECONNRESET"); } };
  await assert.rejects(() => createWorkshopSession(store, COOKIE, down), /ECONNRESET/);
  assert.equal(store.rows.size, 0);
});

test("an unknown session id loads nothing", async () => {
  assert.equal(await loadWorkshopSessionCookies(memoryStore(), "missing"), null);
});

test("a tampered stored session fails closed", async () => {
  const store = memoryStore();
  const created = await createWorkshopSession(store, COOKIE, okLogin);
  if (!created.ok) assert.fail("setup");
  const ciphertext = store.rows.get(created.sessionId)!;
  const parsed = JSON.parse(ciphertext) as { iv: string; ciphertext: string };
  parsed.ciphertext = `${parsed.ciphertext.slice(0, -2)}AA`;
  store.rows.set(created.sessionId, JSON.stringify(parsed));
  await assert.rejects(() => loadWorkshopSessionCookies(store, created.sessionId));
});

test("deleting a session removes its stored cookie", async () => {
  const store = memoryStore();
  const created = await createWorkshopSession(store, COOKIE, okLogin);
  if (!created.ok) assert.fail("setup");
  await deleteWorkshopSession(store, created.sessionId);
  assert.equal(await loadWorkshopSessionCookies(store, created.sessionId), null);
});
