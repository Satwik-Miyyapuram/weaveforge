/**
 * bytea ↔ Uint8Array for Supabase PostgREST.
 */

export function decodeBytea(value: string): Uint8Array {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function encodeBytea(bytes: Uint8Array): string {
  return `\\x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** `encode(bytea, 'base64')` payloads from JSON-RPC (e.g. redeem_share_link). */
export function decodePostgresBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
