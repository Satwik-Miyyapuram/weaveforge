import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSecrets, saveCredentials } from "../_credentials";

type Row = Record<string, unknown>;

function fakeDb(error: unknown = null) {
  const rows: Row[] = [];
  const db = {
    from: (table: string) => ({
      upsert: async (row: Row) => {
        rows.push({ table, ...row });
        return { error };
      },
    }),
  };
  return { db, rows };
}

const seal = (plain: string) => `sealed:${plain}`;

for (const body of [null, [], "text", 42, true]) {
  test(`saveCredentials: 400 for a ${JSON.stringify(body)} body, nothing written (14-02)`, async () => {
    const { db, rows } = fakeDb();
    const res = await saveCredentials({ db, userId: "u1", seal }, body);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /JSON object/);
    assert.equal(rows.length, 0);
  });
}

test("saveCredentials: a database error is sanitised, not echoed (14-02)", async () => {
  const { db } = fakeDb({ code: "42P01", message: 'relation "user_settings" does not exist at host db-internal' });
  const res = await saveCredentials({ db, userId: "u1", seal }, { zoteroApiKey: "k" });
  assert.equal(res.status, 500);
  const { error } = await res.json();
  assert.doesNotMatch(error, /db-internal|relation/);
});

test("saveCredentials: a seal failure is a sanitised 500, nothing written (14-02)", async () => {
  const { db, rows } = fakeDb();
  const boom = () => {
    throw Object.assign(new Error("key load failed at /etc/secret"), { cause: new Error("ENOENT /etc/secret") });
  };
  const res = await saveCredentials({ db, userId: "u1", seal: boom }, { zoteroApiKey: "k" });
  assert.equal(res.status, 500);
  assert.doesNotMatch((await res.json()).error, /ENOENT/);
  assert.equal(rows.length, 0);
});

test("saveCredentials: seals trimmed secrets and clears legacy columns", async () => {
  const { db, rows } = fakeDb();
  const res = await saveCredentials({ db, userId: "u1", seal }, { zoteroApiKey: " k ", semanticScholarKey: "  " });
  assert.equal(res.status, 200);
  assert.equal(rows[0]!.user_id, "u1");
  assert.equal(rows[0]!.credentials_enc, 'sealed:{"zoteroApiKey":"k"}');
  assert.equal(rows[0]!.zotero_api_key, null);
});

test("saveCredentials: an empty object stores null, without sealing", async () => {
  const { db, rows } = fakeDb();
  let sealed = 0;
  const res = await saveCredentials({ db, userId: "u1", seal: (p) => (sealed++, p) }, {});
  assert.equal(res.status, 200);
  assert.equal(rows[0]!.credentials_enc, null);
  assert.equal(sealed, 0);
});

test("cleanSecrets: drops malformed integration fields instead of throwing", () => {
  assert.deepEqual(
    cleanSecrets({
      zoteroApiKey: 5,
      integrations: { a: null, b: "x", c: { token: " t ", n: 3, e: "" }, d: [] },
    }),
    { integrations: { c: { token: " t " } } },
  );
  assert.deepEqual(cleanSecrets({ integrations: "nope" }), {});
});
