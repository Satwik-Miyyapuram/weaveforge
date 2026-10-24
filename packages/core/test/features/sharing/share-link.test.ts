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
  await revoke.execute({ ownerId: "owner", linkId });

  assert.equal(await shareLinks.getById(linkId), null);
});

test("redeeming a malformed token fails with the invalid-link error, not a decoding error", async () => {
  const redeem = new RedeemShareLinkUseCase({ shareLinks, tokenHasher });
  for (const token of ["%%%", "a", "", "abc$def"]) {
    await assert.rejects(redeem.execute(token), { message: "Link is invalid or expired." }, token);
  }
});

test("redeeming an unknown token fails with the invalid-link error", async () => {
  const redeem = new RedeemShareLinkUseCase({ shareLinks, tokenHasher });
  await assert.rejects(redeem.execute(encodeShareLinkToken(new Uint8Array(32))), {
    message: "Link is invalid or expired.",
  });
});

test("an expired link cannot be redeemed", async () => {
  const links = new InMemoryShareLinkRepository();
  const create = new CreateShareLinkUseCase({
    shareLinks: links,
    tokenHasher,
    ids: { newId: () => crypto.randomUUID() },
    clock: { nowIso: () => new Date().toISOString() },
    randomBytes: randomBytesAsync,
  });
  const { urlToken } = await create.execute({
    ownerId: "owner",
    resourceType: "paper",
    resourceId: PAPER_ID,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });

  const redeem = new RedeemShareLinkUseCase({ shareLinks: links, tokenHasher });
  await assert.rejects(redeem.execute(urlToken), { message: "Link is invalid or expired." });
});

test("a link can be redeemed more than once until it expires", async () => {
  const links = new InMemoryShareLinkRepository();
  const create = new CreateShareLinkUseCase({
    shareLinks: links,
    tokenHasher,
    ids: { newId: () => crypto.randomUUID() },
    clock: { nowIso: () => new Date().toISOString() },
    randomBytes: randomBytesAsync,
  });
  const { urlToken } = await create.execute({ ownerId: "owner", resourceType: "paper", resourceId: PAPER_ID });

  const redeem = new RedeemShareLinkUseCase({ shareLinks: links, tokenHasher });
  assert.equal((await redeem.execute(urlToken)).resourceId, PAPER_ID);
  assert.equal((await redeem.execute(urlToken)).resourceId, PAPER_ID);
});
