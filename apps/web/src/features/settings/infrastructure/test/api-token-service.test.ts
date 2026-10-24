/**
 * The token service hands database failures on as they came, code and all, so
 * the routes can map them to safe wording instead of echoing driver text.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ApiTokenService } from "../api-token-service";
import { dbError, fakeTokenBackend } from "@/lib/test/fake-token-backend";

function mockBackend(t: TestContext, code = "42501") {
  fakeTokenBackend(t, { user: "user-1", rest: dbError(code) });
}

const service = () => new ApiTokenService("http://sb.test", "anon", "service", "secret");

for (const [name, run] of [
  ["listTokens", (s: ApiTokenService) => s.listTokens("jwt")],
  ["createToken", (s: ApiTokenService) => s.createToken("jwt", "laptop")],
  ["createMcpRelayToken", (s: ApiTokenService) => s.createMcpRelayToken("jwt", "relay")],
  ["revokeToken", (s: ApiTokenService) => s.revokeToken("jwt", "id-1")],
] as const) {
  test(`api token service: ${name} keeps the database error code`, async (t) => {
    mockBackend(t);
    await assert.rejects(run(service()), (err: unknown) => {
      assert.equal((err as { code?: unknown }).code, "42501");
      return true;
    });
  });
}

test("api token service: resolveSdkAccessToken keeps the database error code", async (t) => {
  mockBackend(t, "PGRST202");
  await assert.rejects(service().resolveSdkAccessToken(`tt_${"a".repeat(43)}`), (err: unknown) => {
    assert.equal((err as { code?: unknown }).code, "PGRST202");
    return true;
  });
});

test("api token service: an unknown session is still 'Invalid session.'", async (t) => {
  fakeTokenBackend(t, { user: null });
  await assert.rejects(service().listTokens("jwt"), /^Error: Invalid session\.$/);
});
