import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ShareMarks, withShareMarks } from "../domain/share-marks";

const SHARE = "00000000-0000-4000-8000-00000000f021";
const PAPER = "00000000-0000-4000-8000-00000000f020";
const OTHER_USER = "00000000-0000-4000-8000-0000000000b2";

function fakeShareRepository() {
  const revoked: string[] = [];
  return {
    grant: async (_input: { recipientId: string; resourceType: string; resourceId: string | null }) => ({
      id: SHARE,
      resourceType: "paper",
      resourceId: PAPER,
    }),
    revoke: async (id: string) => {
      revoked.push(id);
    },
    revoked,
  };
}

function recordingMarks() {
  const calls: string[] = [];
  const marks: ShareMarks = {
    mark: async (ref) => {
      calls.push(`mark:${ref.shareId}:${ref.resourceType}:${ref.resourceId}`);
    },
    unmark: async (id) => {
      calls.push(`unmark:${id}`);
    },
  };
  return { marks, calls };
}

const GRANT = { recipientId: OTHER_USER, resourceType: "paper", resourceId: PAPER };

describe("withShareMarks: grant and revoke keep the marker in step", () => {
  it("a grant marks its share at once, with the resource it covers", async () => {
    const { marks, calls } = recordingMarks();
    const shares = withShareMarks(fakeShareRepository(), marks);
    await shares.grant(GRANT as never);
    assert.deepEqual(calls, [`mark:${SHARE}:paper:${PAPER}`]);
  });

  it("a failed grant marks nothing and the error reaches the caller", async () => {
    const { marks, calls } = recordingMarks();
    const repo = fakeShareRepository();
    repo.grant = async () => {
      throw new Error("permission denied");
    };
    await assert.rejects(withShareMarks(repo, marks).grant(GRANT as never), /permission denied/);
    assert.deepEqual(calls, []);
  });

  it("a revoke unmarks the share and the server revoke goes through", async () => {
    const { marks, calls } = recordingMarks();
    const repo = fakeShareRepository();
    const shares = withShareMarks(repo, marks);
    await shares.revoke(SHARE);
    assert.deepEqual(repo.revoked, [SHARE]);
    assert.deepEqual(calls, [`unmark:${SHARE}`]);
  });

  it("a marker write that throws after a grant still resolves with the share", async () => {
    const failing: ShareMarks = {
      mark: async () => {
        throw new Error("database locked");
      },
      unmark: async () => {},
    };
    const share = await withShareMarks(fakeShareRepository(), failing).grant(GRANT as never);
    assert.equal(share.id, SHARE);
  });

  it("a marker write that throws after a revoke still resolves, and the server revoke stands", async () => {
    const failing: ShareMarks = {
      mark: async () => {},
      unmark: async () => {
        throw new Error("database locked");
      },
    };
    const repo = fakeShareRepository();
    await withShareMarks(repo, failing).revoke(SHARE);
    assert.deepEqual(repo.revoked, [SHARE]);
  });
});
