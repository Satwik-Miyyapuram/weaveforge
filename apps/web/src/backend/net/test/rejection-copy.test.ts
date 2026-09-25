import assert from "node:assert/strict";
import test from "node:test";

import { describeRejection, describedRejections } from "../rejection-copy";

/**
 * The sentences shown to somebody whose pasted URL was refused.
 *
 * This assertion used to live in `packages/core`, beside the URL policy, because
 * the copy did. The copy is presentation and now lives here; the policy module
 * keeps only the reason codes, which is what the rest of core depends on.
 *
 * The completeness half is a compile-time property — `Record<UrlRejection, string>`
 * fails to build if a reason is not covered — so what is checked here is the
 * quality of what is there.
 */

test("every rejection reason has something to say to the person who pasted it", () => {
  const reasons = describedRejections();

  assert.ok(reasons.length >= 6, "the policy's reason codes, all of them");
  for (const reason of reasons) {
    assert.ok(
      describeRejection(reason).length > 10,
      `${reason} needs a sentence, not a code — this is the text a person reads`,
    );
  }
});

test("the copy is a sentence for a person, not the reason code", () => {
  // The failure this guards is a fallback that echoes the enum back at the
  // reader, which reads as a bug in the app rather than as an explanation.
  for (const reason of describedRejections()) {
    assert.notEqual(describeRejection(reason), reason);
    assert.doesNotMatch(describeRejection(reason), /[_-]/, "no snake_case in prose");
  }
});
