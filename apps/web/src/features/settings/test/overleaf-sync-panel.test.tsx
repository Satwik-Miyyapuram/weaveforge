/**
 * A failed first load of the Overleaf links says why (P2-240). The panel
 * swallowed the error and showed an empty list, as if nothing was linked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { FormError } from "@/components/form-error";
import { OverleafSyncPanel } from "../ui/overleaf-sync-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("a failed initial list shows its error (P2-240)", async () => {
  // No desktop shell here, so the list call rejects.
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(createElement(OverleafSyncPanel));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const errors = r.root.findAllByType(FormError);
  assert.equal(errors.length, 1);
  assert.match(JSON.stringify(r.toJSON()), /needs the desktop app/);
  await act(async () => { r.unmount(); });
});