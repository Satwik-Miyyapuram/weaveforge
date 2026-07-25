import assert from "node:assert/strict";
import test from "node:test";
import { openOverleafToken, sealOverleafToken } from "../infrastructure/overleaf-token-crypto";

test.before(() => { process.env.OVERLEAF_CREDENTIAL_KEY = "test-only-overleaf-server-key"; });

test("Overleaf token envelopes round-trip without storing plaintext", () => {
  const token = "overleaf-secret-token";
  const sealed = sealOverleafToken(token);
  assert.doesNotMatch(sealed, /overleaf-secret-token/);
  assert.equal(openOverleafToken(sealed), token);
});

test("tampered Overleaf token envelopes fail closed", () => {
  const sealed = JSON.parse(sealOverleafToken("token")) as { iv: string; ciphertext: string };
  sealed.ciphertext = `${sealed.ciphertext.slice(0, -1)}${sealed.ciphertext.endsWith("A") ? "B" : "A"}`;
  assert.throws(() => openOverleafToken(JSON.stringify(sealed)));
});
