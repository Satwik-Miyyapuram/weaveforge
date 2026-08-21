import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ManageSharingUseCase,
  ShareValidationError,
  type Share,
  type NewShareInput,
  type ShareableType,
  type IShareRepository,
} from "../../../src/index.js";

class FakeShareRepo implements IShareRepository {
  lastGrant: NewShareInput | null = null;
  revoked: string[] = [];
  async grant(input: NewShareInput): Promise<Share> {
    this.lastGrant = input;
    return { id: "share-1", ownerId: "me", ...input, resourceId: input.resourceId ?? null } as Share;
  }
  async revoke(id: string) {
    this.revoked.push(id);
  }
  async listForResource(resourceType: ShareableType, resourceId: string | null): Promise<Share[]> {
    return [{ id: "s", resourceType, resourceId } as Share];
  }
  async listSharedWithMe(): Promise<Share[]> {
    return [{ id: "swm" } as Share];
  }
}

function makeSetup() {
  const repo = new FakeShareRepo();
  return { repo, uc: new ManageSharingUseCase({ repository: repo }) };
}

test("grant: applies defaults (access=comment, resourceId=null) and delegates", async () => {
  const { repo, uc } = makeSetup();
  const share = await uc.grant({ recipientId: "u2", resourceType: "paper" });
  assert.equal(share.access, "comment");
  assert.equal(share.resourceId, null);
  assert.equal(repo.lastGrant?.recipientId, "u2");
});

test("grant: honours an explicit access level and resource id", async () => {
  const { repo, uc } = makeSetup();
  await uc.grant({ recipientId: "u2", resourceType: "paper", resourceId: "p1", access: "edit" });
  assert.equal(repo.lastGrant?.access, "edit");
  assert.equal(repo.lastGrant?.resourceId, "p1");
});

test("grant: rejects a missing recipient and an unknown resource type", async () => {
  const { uc } = makeSetup();
  await assert.rejects(uc.grant({ recipientId: "", resourceType: "paper" }), ShareValidationError);
  await assert.rejects(
    uc.grant({ recipientId: "u2", resourceType: "bogus" as ShareableType }),
    /Unknown resource type/,
  );
});

test("revoke / list: delegate to the repository", async () => {
  const { repo, uc } = makeSetup();
  await uc.revoke("share-9");
  assert.deepEqual(repo.revoked, ["share-9"]);
  assert.equal((await uc.listForResource("paper", "p1")).length, 1);
  assert.equal((await uc.listSharedWithMe()).length, 1);
});
