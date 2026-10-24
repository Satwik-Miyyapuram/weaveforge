import assert from "node:assert/strict";
import test from "node:test";
import { openOverleafToken, sealOverleafToken } from "../infrastructure/overleaf-token-crypto";
import { openCredentialString, sealCredentialString } from "@/features/settings/infrastructure/settings-credential-crypto";

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

test("Overleaf token envelopes use a fresh IV every time", () => {
  const ivs = new Set<string>();
  for (let i = 0; i < 1000; i += 1) ivs.add((JSON.parse(sealOverleafToken("t")) as { iv: string }).iv);
  assert.equal(ivs.size, 1000);
});

test("Overleaf tokens sealed before the shared helper still open", () => {
  // Sealed by the previous overleaf-token-crypto with OVERLEAF_CREDENTIAL_KEY="test-only-overleaf-server-key".
  const legacy = '{"iv":"DNqCFNHnCmeieOA2","ciphertext":"14pXoBZKDglDtWRdTztI0GBLF3R89B7RwcnRufoayDRiefAylQ"}';
  assert.equal(openOverleafToken(legacy), "legacy-overleaf-token");
});

test("Overleaf and settings credentials share one envelope format", () => {
  assert.equal(openCredentialString(sealOverleafToken("same")), "same");
  assert.equal(openOverleafToken(sealCredentialString("same")), "same");
});

test("a non-JSON Overleaf envelope fails closed", () => {
  assert.throws(() => openOverleafToken("not json"));
});
