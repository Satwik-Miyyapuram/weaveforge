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

/** base64 → bytes; also the shape of `encode(bytea, 'base64')` payloads from JSON-RPC. */
export function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Bytes → base64, in chunks: `String.fromCharCode(...bytes)` spreads the whole
 * array onto the call stack and throws once a payload passes ~64K bytes,
 * which a merged Yjs update easily does.
 */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  }
  return btoa(binary);
}
