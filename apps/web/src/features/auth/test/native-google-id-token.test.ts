/**
 * The Android shell's account picker, as the page sees it: a message channel
 * the shell installs only for the app's own origin.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { requestNativeGoogleIdToken } from "../infrastructure/native-google-id-token.js";

type Channel = { postMessage(message: string): void; onmessage: ((event: { data: unknown }) => void) | null };

function shell(reply: unknown) {
  const sent: string[] = [];
  const channel: Channel = {
    onmessage: null,
    postMessage(message) {
      sent.push(message);
      queueMicrotask(() => channel.onmessage?.({ data: reply }));
    },
  };
  return { host: { AndroidGoogleSignIn: channel }, sent, channel };
}

test("off Android there is no picker", async () => {
  assert.deepEqual(await requestNativeGoogleIdToken({}), { kind: "unavailable" });
  assert.deepEqual(await requestNativeGoogleIdToken(undefined), { kind: "unavailable" });
  assert.deepEqual(await requestNativeGoogleIdToken({ AndroidGoogleSignIn: {} }), { kind: "unavailable" });
});

test("a picked account comes back as its ID token and raw nonce", async () => {
  const s = shell(JSON.stringify({ status: "signed-in", idToken: "h.p.s", nonce: "n1" }));
  assert.deepEqual(await requestNativeGoogleIdToken(s.host), { kind: "signed-in", idToken: "h.p.s", nonce: "n1" });
  assert.deepEqual(s.sent, ["request-id-token"]);
  assert.equal(s.channel.onmessage, null);
});

test("closing the picker is a cancel, not a fallback", async () => {
  const s = shell(JSON.stringify({ status: "cancelled" }));
  assert.deepEqual(await requestNativeGoogleIdToken(s.host), { kind: "cancelled" });
});

test("a failure, a bad reply or a reply missing its token falls back to the web sign-in", async () => {
  for (const reply of [
    JSON.stringify({ status: "failed", reason: "no_credential" }),
    "not json",
    42,
    JSON.stringify({ status: "signed-in", idToken: "", nonce: "n" }),
    JSON.stringify({ status: "signed-in", idToken: "t" }),
  ]) {
    assert.deepEqual(await requestNativeGoogleIdToken(shell(reply).host), { kind: "unavailable" }, String(reply));
  }
});

test("a shell that throws on post falls back", async () => {
  const host = { AndroidGoogleSignIn: { onmessage: null, postMessage() { throw new Error("gone"); } } };
  assert.deepEqual(await requestNativeGoogleIdToken(host), { kind: "unavailable" });
  assert.equal(host.AndroidGoogleSignIn.onmessage, null);
});
