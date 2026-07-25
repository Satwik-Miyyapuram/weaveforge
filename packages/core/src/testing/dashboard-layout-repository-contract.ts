import { test } from "node:test";
import assert from "node:assert/strict";
import type { DashboardLayout } from "../features/dashboard/domain/dashboard-layout.js";
import type { IDashboardLayoutRepository } from "../features/dashboard/domain/dashboard-layout-repository.js";

const sampleLayout = (): DashboardLayout => ({
  lg: [
    {
      id: "reading",
      type: "reading-progress",
      x: 0,
      y: 0,
      w: 3,
      h: 2,
    },
  ],
  sm: [
    {
      id: "reading",
      type: "reading-progress",
      x: 0,
      y: 0,
      w: 2,
      h: 2,
    },
  ],
});

export function runDashboardLayoutRepositoryContract(
  label: string,
  makeRepo: () => IDashboardLayoutRepository,
): void {
  test(`[${label}] get returns null when absent`, async () => {
    const repo = makeRepo();
    assert.equal(await repo.get("missing"), null);
  });

  test(`[${label}] save then get round-trips`, async () => {
    const repo = makeRepo();
    const layout = sampleLayout();
    await repo.save("p1", layout);
    const found = await repo.get("p1");
    assert.deepEqual(found, layout);
  });

  test(`[${label}] save overwrites prior layout`, async () => {
    const repo = makeRepo();
    await repo.save("p1", sampleLayout());
    const next = sampleLayout();
    next.lg[0]!.w = 6;
    await repo.save("p1", next);
    const found = await repo.get("p1");
    assert.equal(found?.lg[0]?.w, 6);
  });
}
