import assert from "node:assert/strict";
import test from "node:test";
import {
  isCredentialScope,
  openCredential,
  sealCredential,
  type CredentialBinding,
} from "../credential-seal";

// Sealed by the Node reference and by apps/relay/server/tests/credential_crypto.rs.
const KEY = "test-key";
const IV = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const PLAIN = '{"zoteroApiKey":"abc"}';
const NODE_ENVELOPE =
  '{"iv":"AAECAwQFBgcICQoL","ciphertext":"yUpOCgagenyCpkh6Ah1WV5HDhGVN85on62pTzenZGcj6uBNe4OA"}';

const BINDING: CredentialBinding = {
  userId: "11111111-1111-4111-8111-111111111111",
  scope: "account",
  name: "zotero",
};

test("an unbound envelope sealed by the Node and Rust reference still opens", () => {
  assert.equal(openCredential(NODE_ENVELOPE, KEY), PLAIN);
});

test("sealing without a binding reproduces the reference envelope byte for byte", () => {
  assert.equal(sealCredential(PLAIN, KEY, undefined, IV), NODE_ENVELOPE);
});

test("a bound envelope opens with the same user, scope and name", () => {
  const sealed = sealCredential(PLAIN, KEY, BINDING);
  assert.equal(openCredential(sealed, KEY, BINDING), PLAIN);
});

test("AAD mismatch is rejected for a copied user id", () => {
  const sealed = sealCredential(PLAIN, KEY, BINDING);
  assert.throws(
    () => openCredential(sealed, KEY, { ...BINDING, userId: "22222222-2222-4222-8222-222222222222" }),
    /could not be decrypted/,
  );
});

test("AAD mismatch is rejected for a copied scope or name", () => {
  const sealed = sealCredential(PLAIN, KEY, BINDING);
  assert.throws(() => openCredential(sealed, KEY, { ...BINDING, scope: "workspace:w1" }), /could not be decrypted/);
  assert.throws(() => openCredential(sealed, KEY, { ...BINDING, name: "mattermost" }), /could not be decrypted/);
});

test("a bound envelope refuses to open without its binding", () => {
  const sealed = sealCredential(PLAIN, KEY, BINDING);
  assert.throws(() => openCredential(sealed, KEY), /requires its binding/);
});

test("a legacy envelope without AAD stays readable under a binding and is re-sealed bound", () => {
  const legacy = openCredential(NODE_ENVELOPE, KEY, BINDING);
  assert.equal(legacy, PLAIN);
  const resealed = sealCredential(legacy, KEY, BINDING);
  assert.notEqual(resealed, NODE_ENVELOPE);
  assert.equal(openCredential(resealed, KEY, BINDING), PLAIN);
});

test("stripping the bound marker from a bound envelope does not make it open", () => {
  const sealed = JSON.parse(sealCredential(PLAIN, KEY, BINDING)) as Record<string, unknown>;
  delete sealed.bound;
  assert.throws(() => openCredential(JSON.stringify(sealed), KEY, BINDING), /could not be decrypted/);
  assert.throws(() => openCredential(JSON.stringify(sealed), KEY), /could not be decrypted/);
});

test("adding the bound marker to a legacy envelope does not make it open under a binding", () => {
  const forged = JSON.parse(NODE_ENVELOPE) as Record<string, unknown>;
  forged.bound = true;
  assert.throws(() => openCredential(JSON.stringify(forged), KEY, BINDING), /could not be decrypted/);
});

test("wrong key, missing key, non-JSON and short ciphertext are rejected", () => {
  assert.throws(() => openCredential(NODE_ENVELOPE, "other"), /could not be decrypted/);
  assert.throws(() => openCredential(NODE_ENVELOPE, undefined), /OVERLEAF_CREDENTIAL_KEY/);
  assert.throws(() => openCredential("nope", KEY), /not JSON/);
  assert.throws(() => openCredential('{"iv":"AAECAwQFBgcICQoL","ciphertext":"AAAA"}', KEY), /too short/);
  assert.throws(() => sealCredential(PLAIN, undefined, BINDING), /OVERLEAF_CREDENTIAL_KEY/);
});

test("scopes are account or workspace:{id} only", () => {
  assert.equal(isCredentialScope("account"), true);
  assert.equal(isCredentialScope("workspace:w1"), true);
  assert.equal(isCredentialScope("workspace:"), false);
  assert.equal(isCredentialScope("team:x"), false);
});
