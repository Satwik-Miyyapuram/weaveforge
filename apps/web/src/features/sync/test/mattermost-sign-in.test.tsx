import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mattermostNotificationManifest } from "@/integrations/manifests/mattermost";

/**
 * Mattermost sign-in names no server of its own. The user types the server
 * URL; until they do, the sign-in button stays disabled and says why.
 */

const g = globalThis as { window?: unknown };
let hadWindow = false;

before(() => {
  hadWindow = "window" in g;
  // The smallest desktop bridge `desktop()` accepts, with sign-in available.
  g.window = { weaveforge: { fetchTitle: () => undefined, mattermostSignIn: async () => null } };
});

after(() => {
  if (!hadWindow) delete g.window;
});

async function renderButton(serverUrl: string) {
  const { MattermostSignInButton } = await import("../ui/mattermost-sign-in-button");
  return renderToStaticMarkup(createElement(MattermostSignInButton, { serverUrl, onToken: () => undefined }));
}

describe("Mattermost sign-in", () => {
  it("has no built-in default server", async () => {
    const mod: Record<string, unknown> = await import("../ui/mattermost-sign-in-button");
    assert.equal(mod.DEFAULT_MATTERMOST_SERVER, undefined);
  });

  it("disables the button and asks for a server when none is given", async () => {
    for (const blank of ["", "   "]) {
      const html = await renderButton(blank);
      assert.match(html, /<button[^>]*disabled/);
      assert.match(html, /Enter your Mattermost server URL/);
    }
  });

  it("enables the button once a server is given", async () => {
    const html = await renderButton("https://chat.example.org");
    assert.doesNotMatch(html, /<button[^>]*disabled/);
    assert.doesNotMatch(html, /Enter your Mattermost server URL/);
  });

  it("asks for the server URL and channel in sign-in mode, never the token", async () => {
    const { fieldsShown } = await import("../ui/sync-settings");
    const fields = mattermostNotificationManifest.projectDescriptors[0]!.fields;
    assert.deepEqual(
      fieldsShown(fields, true).map((f) => f.key),
      ["repo", "branch"],
    );
    assert.deepEqual(
      fieldsShown(fields, false).map((f) => f.key),
      ["token", "repo", "branch"],
    );
  });
});
