/**
 * Share-link tokens. Encoding and decoding live in the Rust core (wf-core
 * `sharing::encode_share_link_token` / `decode_share_link_token`); generating
 * and hashing stay here because they take injected randomness and crypto.
 */

/** SHA-256 hash of raw link token bytes (stored server-side). */
export interface IShareLinkTokenHasher {
  hash(token: Uint8Array): Promise<Uint8Array>;
}

const TOKEN_BYTES = 32;

export function generateShareLinkToken(randomBytes: (n: number) => Promise<Uint8Array>): Promise<Uint8Array> {
  return randomBytes(TOKEN_BYTES);
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface ShareLinkTokenFns {
  /** Base64url token for URL query param `?t=`. */
  encodeShareLinkToken(token: Uint8Array): string;
  /** Bytes of a URL token; throws on one that is not base64. */
  decodeShareLinkToken(encoded: string): Uint8Array;
}
