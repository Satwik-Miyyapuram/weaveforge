import type { IShareLinkTokenHasher } from "@weaveforge/core";

export class WebCryptoShareLinkTokenHasher implements IShareLinkTokenHasher {
  async hash(token: Uint8Array): Promise<Uint8Array> {
    const bytes = new Uint8Array(token);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return new Uint8Array(digest);
  }
}
