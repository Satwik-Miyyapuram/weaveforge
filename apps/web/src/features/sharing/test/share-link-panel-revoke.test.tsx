/**
 * Revoking a link hides the "copy this link now" block (P2-246). The block
 * kept showing a URL that no longer opens anything.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import { ShareLinkPanel } from "../ui/share-link-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const g = globalThis as { window?: unknown };
const hadWindow = "window" in g;
const oldWindow = g.window;

before(async () => {
  await loadTestCore();
  g.window = { location: { origin: "https://app.test" } };
});
after(() => {
  setContainerForTests(null);
  if (hadWindow) g.window = oldWindow;
  else delete g.window;
});

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });

test("revoking the link hides its copy-now URL (P2-246)", async () => {
  let links: { id: string; createdAt: string; expiresAt: string | null }[] = [];
  setContainerForTests({
    sharing: {
      shareLinksEnabled: () => true,
      listShareLinks: async () => links,
      createShareLink: async () => {
        links = [{ id: "s1", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: null }];
        return { urlToken: "tok" };
      },
      revokeShareLink: async () => { links = []; },
    },
  } as never);
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(createElement(ShareLinkPanel, { resourceType: "note" as never, resourceId: "n1" }));
  });
  await flush();
  const button = (label: string) =>
    r.root.findAll((n) => n.type === "button" && n.props.children === label)[0]!;
  const urlBlocks = () => r.root.findAll((n) => n.props["data-testid"] === "share-link-url" && typeof n.type === "string");

  await act(async () => { button("Create view link").props.onClick(); });
  await flush();
  assert.equal(urlBlocks().length, 1);

  await act(async () => { button("Revoke").props.onClick(); });
  await flush();
  assert.equal(urlBlocks().length, 0);
  await act(async () => { r.unmount(); });
});