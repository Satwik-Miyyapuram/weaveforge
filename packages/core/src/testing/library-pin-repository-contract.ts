/**
 * Shared CONTRACT suite for ILibraryPinRepository. Every implementation must pass
 * these identical checks (Liskov).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ILibraryPinRepository } from "../features/library/domain/library-pin-repository.js";

export function runLibraryPinRepositoryContract(
  label: string,
  makeRepo: () => ILibraryPinRepository,
): void {
  test(`[${label}] pin then listForProject returns the pin`, async () => {
    const repo = makeRepo();
    const pin = await repo.pin({
      resourceType: "paper",
      resourceId: "p1",
      ownerId: "alice",
    });
    assert.equal(pin.resourceId, "p1");
    assert.equal(pin.ownerId, "alice");
    const list = await repo.listForProject();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.resourceId, "p1");
  });

  test(`[${label}] pin is idempotent on the same resource`, async () => {
    const repo = makeRepo();
    const first = await repo.pin({
      resourceType: "paper",
      resourceId: "p1",
      ownerId: "alice",
    });
    const second = await repo.pin({
      resourceType: "paper",
      resourceId: "p1",
      ownerId: "alice",
    });
    assert.equal(first.id, second.id);
    assert.equal((await repo.listForProject()).length, 1);
  });

  test(`[${label}] unpin removes the pin`, async () => {
    const repo = makeRepo();
    await repo.pin({ resourceType: "paper", resourceId: "p1", ownerId: "alice" });
    await repo.unpin("paper", "p1");
    assert.equal((await repo.listForProject()).length, 0);
    assert.equal(await repo.isPinned("paper", "p1"), false);
  });

  test(`[${label}] isPinned reflects pin state`, async () => {
    const repo = makeRepo();
    assert.equal(await repo.isPinned("paper", "p1"), false);
    await repo.pin({ resourceType: "paper", resourceId: "p1", ownerId: "alice" });
    assert.equal(await repo.isPinned("paper", "p1"), true);
  });
}
