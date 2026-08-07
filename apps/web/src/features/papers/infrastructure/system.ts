import type { Clock, IdGenerator } from "@weaveforge/core";

/** Concrete system Clock — injected so domain/use-cases stay pure & testable. */
export const systemClock: Clock = {
  nowIso: () => new Date().toISOString(),
};

/** UUID generator backed by the platform crypto. */
export const uuidIds: IdGenerator = {
  newId: () => crypto.randomUUID(),
};
