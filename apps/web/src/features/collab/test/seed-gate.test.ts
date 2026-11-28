/** The editor takes no typing before its seed: a keystroke into the empty pre-seed document was kept as a conflict block. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { hideUntilSeeded } from "../ui/seed-gate";

function host() {
  return { style: { visibility: "" } };
}

test("the editor host is hidden until the document is seeded", () => {
  const el = host();
  const reveal = hideUntilSeeded(el);
  assert.equal(el.style.visibility, "hidden");
  reveal();
  assert.equal(el.style.visibility, "");
});

test("a remount hides the host again until its own seed", () => {
  const el = host();
  hideUntilSeeded(el)();
  hideUntilSeeded(el);
  assert.equal(el.style.visibility, "hidden");
});
