import type { Clock, IdGenerator } from "@weaveforge/core";

/**
 * The three ways the application touches something it cannot control: the
 * clock, the id generator, and random bytes.
 *
 * They live together, and outside any one feature, because they are what every
 * feature's tests have to replace and no feature owns them. `randomBytes` was
 * the odd one out: two of these were extracted into a module under
 * `features/papers/infrastructure/` — a directory about papers — while the
 * third was written inline at the composition root, so the same decision (inject
 * the non-deterministic edge) was made two different ways in one file.
 */

/** Concrete system Clock — injected so domain/use-cases stay pure & testable. */
export const systemClock: Clock = {
  nowIso: () => new Date().toISOString(),
};

/** UUID generator backed by the platform crypto. */
export const uuidIds: IdGenerator = {
  newId: () => crypto.randomUUID(),
};

/**
 * `n` cryptographically random bytes.
 *
 * Async to match the port that takes it (`CreateShareLinkUseCase`), which is
 * shaped that way because a non-browser caller may have to await a source of
 * randomness. A test double is one line; a test that reaches for `crypto`
 * instead is not.
 */
export const randomBytes: (n: number) => Promise<Uint8Array> = async (n) => {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
};
