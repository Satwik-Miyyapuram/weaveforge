/** SHA-256 hash of raw link token bytes (stored server-side). */
export interface IShareLinkTokenHasher {
  hash(token: Uint8Array): Promise<Uint8Array>;
}

const TOKEN_BYTES = 32;

export function generateShareLinkToken(randomBytes: (n: number) => Promise<Uint8Array>): Promise<Uint8Array> {
  return randomBytes(TOKEN_BYTES);
}

/** Base64url token for URL query param `?t=`. */
export function encodeShareLinkToken(token: Uint8Array): string {
  let bin = "";
  for (const b of token) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShareLinkToken(encoded: string): Uint8Array {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? padded : padded + "=".repeat(4 - (padded.length % 4));
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
