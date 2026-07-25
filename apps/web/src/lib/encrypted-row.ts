/**
 * Row <-> entity ciphertext-column shims. Client E2EE was dropped, so these are
 * no-ops: nothing is attached on read and no content_enc columns are written.
 * Kept as thin pass-throughs so the repositories don't each need bespoke row
 * mapping; safe to inline away entirely in a later cleanup.
 */

export interface EncryptedRowColumns {
  content_enc?: string | null;
  enc_epoch?: number | null;
  list_content_enc?: string | null;
  list_enc_epoch?: number | null;
}

const LIST_ENCRYPTED_STORAGE = Symbol.for("thesis.encryptedListStorage");

/** No-op: there are no ciphertext columns to read onto the entity. */
export function attachEncryptedRow<T extends object>(entity: T, _row: object): T {
  return entity;
}

/** No ciphertext columns to write. */
export function encryptedRowFields(_entity: object): EncryptedRowColumns {
  return {};
}

export function encryptedListRowFields(_entity: object): EncryptedRowColumns {
  return {};
}

// Plain entity-property helpers (not crypto): retained for any callers that
// still stash/read list metadata on an entity in memory.
export function getEncryptedListStorage(
  entity: object,
): { contentEnc: string; encEpoch: number } | undefined {
  return (entity as Record<symbol, { contentEnc: string; encEpoch: number }>)[LIST_ENCRYPTED_STORAGE];
}

export function setEncryptedListStorage(
  entity: object,
  meta: { contentEnc: string; encEpoch: number },
): void {
  (entity as Record<symbol, { contentEnc: string; encEpoch: number }>)[LIST_ENCRYPTED_STORAGE] = meta;
}
