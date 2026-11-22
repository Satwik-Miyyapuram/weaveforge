/**
 * Port for the KEYS move. 0.9.7 is copy-only: the port has no delete, so a
 * secret is never removed from its source.
 */
export type SecretsPort = {
  /** Ids of the secrets held by the source. */
  list(): Promise<string[]>;
  /** True when the target already holds the secret with this id. */
  exists(id: string): Promise<boolean>;
  /** Copies one secret from the source to the target. */
  copy(id: string): Promise<void>;
};

/**
 * Builds the moveSecrets hook. Idempotent: a secret already in the target is
 * skipped, so a re-run after a failed marker copies nothing twice.
 */
export function createSecretMover(port: SecretsPort): () => Promise<void> {
  return async () => {
    for (const id of await port.list()) {
      if (await port.exists(id)) continue;
      await port.copy(id);
    }
  };
}
