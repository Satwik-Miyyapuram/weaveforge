import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { neverOffered, preferenceMemory, shouldOfferSync } from "../application/sync-offer";

function bridge(initial: string | boolean | null = null) {
  let stored = initial;
  return {
    get stored() {
      return stored;
    },
    readPreference: async () => stored,
    writePreference: async (_name: "sync-offer-shown", value: string | boolean | null) => {
      stored = value;
    },
  };
}

describe("the sync offer", () => {
  it("is made to a device that has never been asked", async () => {
    const memory = preferenceMemory(bridge());
    assert.equal(await shouldOfferSync({ memory, enabled: async () => false }), true);
  });

  it("is never made twice", async () => {
    const shell = bridge();
    const memory = preferenceMemory(shell);
    await memory.markShown();
    assert.equal(shell.stored, true);
    assert.equal(await shouldOfferSync({ memory, enabled: async () => false }), false);
  });

  it("is not made to a device that already syncs", async () => {
    const memory = preferenceMemory(bridge());
    assert.equal(await shouldOfferSync({ memory, enabled: async () => true }), false);
  });

  it("is not made in a browser, which has nothing to adopt", async () => {
    assert.equal(await shouldOfferSync({ memory: neverOffered, enabled: async () => false }), false);
  });
});
