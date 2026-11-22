import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ORG_SERVER_RPCS, ORG_SERVER_TABLES } from "../org-server-allowlist";

const PERSONAL = ["papers", "notes", "tags", "settings", "metrics", "relations", "pins", "projects"];

describe("org server allowlist", () => {
  it("excludes every personal table", () => {
    for (const t of PERSONAL) assert.equal((ORG_SERVER_TABLES as readonly string[]).includes(t), false, t);
  });
  it("includes the share and org tables", () => {
    for (const t of ["organizations", "org_memberships", "project_shares", "share_links"]) {
      assert.equal((ORG_SERVER_TABLES as readonly string[]).includes(t), true, t);
    }
  });
  it("lists only org and share rpcs", () => {
    assert.equal((ORG_SERVER_RPCS as readonly string[]).includes("resolve_share_link"), true);
    assert.equal((ORG_SERVER_RPCS as readonly string[]).includes("latest_metric_activity"), false);
  });
});
