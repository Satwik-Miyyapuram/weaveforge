import { test } from "node:test";
import assert from "node:assert/strict";

import { isIsoDay } from "../../../src/features/plan/domain/milestone.js";

test("isIsoDay accepts real calendar days only", () => {
  for (const good of ["2026-01-01", "2026-12-31", "2024-02-29", "2000-02-29"]) assert.equal(isIsoDay(good), true, good);
  for (const bad of [
    "2026-02-31", "2025-02-29", "1900-02-29", "2026-13-01", "2026-00-01", "2026-01-00", "2026-04-31",
    "26-01-01", "2026-1-01", "2026-01-01T00:00:00Z", " 2026-01-01", "", "nope",
  ]) assert.equal(isIsoDay(bad), false, JSON.stringify(bad));
});
