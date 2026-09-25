/**
 * The capabilities as the desktop build answers them.
 *
 * A separate file from `capabilities.test.ts` on purpose: `build-target.ts`
 * reads `process.env.NEXT_PUBLIC_WEAVEFORGE_DESKTOP` once, at module load, and
 * the bundler replaces it with a literal — so the only way to ask "what does a
 * static export say?" is to set the flag before anything imports it. Node's test
 * runner gives each file its own process, and every import here is dynamic and
 * happens after the assignment.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.NEXT_PUBLIC_WEAVEFORGE_DESKTOP = "1";

describe("capabilities on a deployment with no server of its own", () => {
  it("has no routes, but still has an account", async () => {
    const { hasAccount, hasServerRoutes, can } = await import("../capabilities");
    assert.equal(hasServerRoutes(), false);
    // The two are deliberately different questions. Signing in on the desktop
    // works, and this is why the account capabilities stay true.
    assert.equal(hasAccount(), true);
    assert.equal(can("account"), true);
    assert.equal(can("sync"), true);
    assert.equal(can("operatorDisclosure"), true);
  });

  it("refuses the capabilities that need a route of our own", async () => {
    const { can } = await import("../capabilities");
    // Both issue requests a static export cannot serve: `/api/settings/api-tokens`
    // and `/api/org/*`. Answering yes mounted the Tokens and Org tabs on a
    // signed-in desktop build, where every action behind them failed.
    assert.equal(can("apiTokens"), false, "apiTokens needs a route to mint them");
    assert.equal(can("org"), false, "org is served entirely by routes");
  });
});
