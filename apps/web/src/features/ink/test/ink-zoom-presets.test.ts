/** The View menu's zoom presets lie inside the ink zoom limits (23-14). */
import { test } from "node:test";
import assert from "node:assert/strict";

import { INK_ZOOM_MAX, INK_ZOOM_MIN } from "@weaveforge/core";
import { ZOOM_PRESETS } from "../ui/ink-bar-view";

test("every zoom preset is within the ink zoom limits", () => {
  for (const level of ZOOM_PRESETS) {
    assert.ok(level / 100 >= INK_ZOOM_MIN && level / 100 <= INK_ZOOM_MAX, `${level}%`);
  }
});
