import { test } from "node:test";
import assert from "node:assert/strict";
import { PinSharedResourceUseCase } from "../../../src/features/library/application/pin-shared-resource.use-case.js";
import { LibraryPinError } from "../../../src/features/library/domain/library-pin.js";
import { InMemoryLibraryPinRepository } from "../../../src/testing/in-memory-library-pin-repository.js";
import { InMemoryShareRepository } from "../../../src/testing/in-memory-share-repository.js";

test("pin succeeds when a matching share exists", async () => {
  const shares = new InMemoryShareRepository("alice");
  await shares.grant({
    recipientId: "me",
    resourceType: "paper",
    resourceId: "p1",
    access: "view",
  });
  shares.setCurrent("me");

  const pins = new InMemoryLibraryPinRepository("me");
  const uc = new PinSharedResourceUseCase({ pins, shares });

  const pin = await uc.execute({
    resourceType: "paper",
    resourceId: "p1",
    ownerId: "alice",
  });
  assert.equal(pin.resourceId, "p1");
  assert.equal(await pins.isPinned("paper", "p1"), true);
});

test("pin succeeds for blanket share", async () => {
  const shares = new InMemoryShareRepository("alice");
  await shares.grant({
    recipientId: "me",
    resourceType: "paper",
    resourceId: null,
  });
  shares.setCurrent("me");

  const pins = new InMemoryLibraryPinRepository("me");
  const uc = new PinSharedResourceUseCase({ pins, shares });

  await uc.execute({ resourceType: "paper", resourceId: "p9", ownerId: "alice" });
  assert.equal(await pins.isPinned("paper", "p9"), true);
});

test("pin rejects when no share covers the resource", async () => {
  const shares = new InMemoryShareRepository("alice");
  shares.setCurrent("me");
  const pins = new InMemoryLibraryPinRepository("me");
  const uc = new PinSharedResourceUseCase({ pins, shares });

  await assert.rejects(
    () => uc.execute({ resourceType: "paper", resourceId: "p1", ownerId: "alice" }),
    LibraryPinError,
  );
});
