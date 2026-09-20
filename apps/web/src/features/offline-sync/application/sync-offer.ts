/**
 * Whether to make the offer, and the record that it was made.
 *
 * The offer is shown once in a device's life: one dismissible card, never a
 * modal, and after that it is a row in Settings and nothing else. An app that
 * asks twice has learned that asking works, and the reader learns to dismiss
 * without reading (`docs/internal/plans/completed/offline-first-sync.md` D2).
 *
 * The bit lives in the shell's preference file rather than in the app, because
 * it has to survive a reinstall-over-upgrade — a cleared browser store must not
 * make a one-time offer twice.
 */

export interface OfferMemory {
  read(): Promise<boolean>;
  markShown(): Promise<void>;
}

export interface OfferInputs {
  memory: OfferMemory;
  /** Whether this device already syncs; an adopted device is never offered. */
  enabled: () => Promise<boolean>;
}

export async function shouldOfferSync(inputs: OfferInputs): Promise<boolean> {
  if (await inputs.memory.read()) return false;
  // Asking someone who already said yes reads as the app having forgotten.
  return !(await inputs.enabled());
}

/** The shell's preference file, seen as the one bit this cares about. */
export function preferenceMemory(bridge: {
  readPreference(name: "sync-offer-shown"): Promise<string | boolean | null>;
  writePreference(name: "sync-offer-shown", value: string | boolean | null): Promise<void>;
}): OfferMemory {
  return {
    // The declared type is `string | boolean | null`, so the one-time bit must
    // not depend on which of those a given shell round-trips. Today's Electron
    // store writes JSON and reads it back as a boolean, so a `"true"` string
    // means a hand-edited or corrupted preference file rather than a normal
    // path — and that is exactly the case worth surviving, because the failure
    // is an offer that reappears after every upgrade.
    read: async () => isTruthy(await bridge.readPreference("sync-offer-shown")),
    markShown: () => bridge.writePreference("sync-offer-shown", true),
  };
}

function isTruthy(value: string | boolean | null): boolean {
  return value === true || value === "true" || value === "1";
}

/**
 * A browser has no shell to remember anything, and no local database to adopt.
 * Never offering is the honest answer rather than offering every reload.
 */
export const neverOffered: OfferMemory = {
  read: async () => true,
  markShown: async () => {},
};
