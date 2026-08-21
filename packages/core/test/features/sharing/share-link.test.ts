import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  CreateShareLinkUseCase,
  RedeemShareLinkUseCase,
  RevokeShareLinkUseCase,
  SHARE_LINK_DEFAULT_TTL_DAYS,
  encodeShareLinkToken,
  decodeShareLinkToken,
} from "../../../src/features/sharing/index.js";
import type { IShareLinkTokenHasher } from "../../../src/features/sharing/domain/share-link-token.js";
import { InMemoryShareLinkRepository } from "../../../src/testing/in-memory-share-link-repository.js";

const shareLinks = new InMemoryShareLinkRepository();

const tokenHasher: IShareLinkTokenHasher = {
  hash: async (token) => createHash("sha256").update(token).digest(),
};

const PAPER_ID = "550e8400-e29b-41d4-a716-446655440000";

const randomBytesAsync = async (n: number) => new Uint8Array(randomBytes(n));

test("create + redeem share link resolves plaintext resource", async () => {
  const create = new CreateShareLinkUseCase({
    shareLinks,
    tokenHasher,
    ids: { newId: () => crypto.randomUUID() },
    clock: { nowIso: () => new Date().toISOString() },
    randomBytes: randomBytesAsync,
  });

  const { urlToken } = await create.execute({
    ownerId: "owner",
    resourceType: "paper",
    resourceId: PAPER_ID,
  });

  const redeem = new RedeemShareLinkUseCase({
    shareLinks,
    tokenHasher,
  });

  const resolved = await redeem.execute(urlToken);
  assert.equal(resolved.resourceId, PAPER_ID);
  assert.equal(resolved.resourceType, "paper");

  const roundTrip = decodeShareLinkToken(encodeShareLinkToken(decodeShareLinkToken(urlToken)));
  assert.equal(roundTrip.length, 32);

  const listed = await shareLinks.listForResource("paper", PAPER_ID);
  assert.equal(listed.length, 1);
  assert.ok(listed[0]!.expiresAt);
  const expires = new Date(listed[0]!.expiresAt!);
  const created = new Date(listed[0]!.createdAt);
  const diffDays = (expires.getTime() - created.getTime()) / (24 * 60 * 60 * 1000);
  assert.ok(Math.abs(diffDays - SHARE_LINK_DEFAULT_TTL_DAYS) < 0.01);
  assert.equal(listed[0]!.dekWrap ?? null, null);
});

test("create share link respects explicit null expiry", async () => {
  const MILESTONE_ID = "660e8400-e29b-41d4-a716-446655440001";
  const create = new CreateShareLinkUseCase({
    shareLinks,
    tokenHasher,
    ids: { newId: () => crypto.randomUUID() },
    clock: { nowIso: () => new Date().toISOString() },
    randomBytes: randomBytesAsync,
  });

  await create.execute({
    ownerId: "owner",
    resourceType: "milestone",
    resourceId: MILESTONE_ID,
    expiresAt: null,
  });

  const listed = await shareLinks.listForResource("milestone", MILESTONE_ID);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.expiresAt, null);
});

test("revoke share link deletes the link", async () => {
  const create = new CreateShareLinkUseCase({
    shareLinks,
    tokenHasher,
    ids: { newId: () => crypto.randomUUID() },
    clock: { nowIso: () => new Date().toISOString() },
    randomBytes: randomBytesAsync,
  });
  const { linkId } = await create.execute({
    ownerId: "owner",
    resourceType: "paper",
    resourceId: PAPER_ID,
  });

  const revoke = new RevokeShareLinkUseCase({ shareLinks });
  await revoke.execute({ ownerId: "owner", linkId, rotateDek: true });

  assert.equal(await shareLinks.getById(linkId), null);
});
