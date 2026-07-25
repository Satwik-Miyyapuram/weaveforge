import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readBackendConfig } from "@/backend/config";

type TokenEnvelope = { iv: string; ciphertext: string };

function key(): Buffer {
  const secret = readBackendConfig().overleafCredentialKey;
  if (!secret) throw new Error("OVERLEAF_CREDENTIAL_KEY is not configured on the server.");
  return createHash("sha256").update(secret).digest();
}

function b64(bytes: Uint8Array): string { return Buffer.from(bytes).toString("base64url"); }
function unb64(value: string): Buffer { return Buffer.from(value, "base64url"); }

export function sealOverleafToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return JSON.stringify({ iv: b64(iv), ciphertext: b64(ciphertext) } satisfies TokenEnvelope);
}

export function openOverleafToken(envelope: string): string {
  let parsed: TokenEnvelope;
  try { parsed = JSON.parse(envelope) as TokenEnvelope; } catch { throw new Error("Stored Overleaf credential is invalid."); }
  const raw = unb64(parsed.ciphertext);
  if (raw.length <= 16) throw new Error("Stored Overleaf credential is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key(), unb64(parsed.iv));
  decipher.setAuthTag(raw.subarray(-16));
  return Buffer.concat([decipher.update(raw.subarray(0, -16)), decipher.final()]).toString("utf8");
}
