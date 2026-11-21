/**
 * A desktop sign-in that cannot be finished is logged, never an unhandled
 * rejection (P2-147). The bridge handler's `import("@/light-bootstrap")` had
 * no `.catch`, so a chunk that failed to load was lost without a trace.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { AppLogInput } from "@/lib/error-report/app-log";
import { completeDesktopSignIn } from "../ui/complete-desktop-sign-in";

test("a chunk that fails to load is logged and does not reject", async () => {
  const logged: AppLogInput[] = [];
  await completeDesktopSignIn("code=abc", {
    load: () => Promise.reject(new Error("chunk failed")),
    log: (line) => logged.push(line),
    isActive: () => true,
  });
  assert.equal(logged.length, 1);
  assert.equal(logged[0]?.level, "error");
  assert.match(logged[0]?.detail ?? "", /chunk failed/);
});

test("a refused exchange is logged and does not reject", async () => {
  const logged: AppLogInput[] = [];
  await completeDesktopSignIn("code=abc", {
    load: async () => ({
      getLightContainer: () => ({
        auth: { completeOAuth: () => Promise.reject(new Error("bad code")) },
      }),
    }),
    log: (line) => logged.push(line),
    isActive: () => true,
  });
  assert.equal(logged.length, 1);
  assert.match(logged[0]?.detail ?? "", /bad code/);
});

test("a good exchange redeems the query and logs nothing", async () => {
  const logged: AppLogInput[] = [];
  const redeemed: string[] = [];
  await completeDesktopSignIn("code=abc", {
    load: async () => ({
      getLightContainer: () => ({
        auth: { completeOAuth: async (q: string) => void redeemed.push(q) },
      }),
    }),
    log: (line) => logged.push(line),
    isActive: () => true,
  });
  assert.deepEqual(redeemed, ["code=abc"]);
  assert.equal(logged.length, 0);
});

test("an unmounted provider does not redeem", async () => {
  const redeemed: string[] = [];
  await completeDesktopSignIn("code=abc", {
    load: async () => ({
      getLightContainer: () => ({
        auth: { completeOAuth: async (q: string) => void redeemed.push(q) },
      }),
    }),
    log: () => {},
    isActive: () => false,
  });
  assert.deepEqual(redeemed, []);
});
