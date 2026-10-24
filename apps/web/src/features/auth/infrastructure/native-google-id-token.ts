/**
 * The Android shell's Google account picker.
 *
 * The shell installs `AndroidGoogleSignIn` as a web message channel for the
 * app's own origin only. The page posts one request; the shell shows the
 * system account sheet and replies with the account's ID token and the raw
 * nonce whose hash Google signed into it. Anywhere else there is no channel
 * and the caller uses the web sign-in.
 */
export type NativeGoogleSignIn =
  | { kind: "signed-in"; idToken: string; nonce: string }
  | { kind: "cancelled" }
  | { kind: "unavailable" };

export type RequestNativeGoogleIdToken = () => Promise<NativeGoogleSignIn>;

type Channel = { postMessage(message: string): void; onmessage: ((event: { data: unknown }) => void) | null };

const UNAVAILABLE: NativeGoogleSignIn = { kind: "unavailable" };

export function requestNativeGoogleIdToken(
  host: unknown = globalThis,
): Promise<NativeGoogleSignIn> {
  const channel = (host as { AndroidGoogleSignIn?: Partial<Channel> } | undefined)?.AndroidGoogleSignIn;
  if (typeof channel?.postMessage !== "function") return Promise.resolve(UNAVAILABLE);
  const ch = channel as Channel;
  return new Promise((resolve) => {
    ch.onmessage = (event) => {
      ch.onmessage = null;
      resolve(readReply(event.data));
    };
    try {
      ch.postMessage("request-id-token");
    } catch {
      ch.onmessage = null;
      resolve(UNAVAILABLE);
    }
  });
}

function readReply(data: unknown): NativeGoogleSignIn {
  if (typeof data !== "string") return UNAVAILABLE;
  let reply: { status?: unknown; idToken?: unknown; nonce?: unknown };
  try {
    reply = JSON.parse(data);
  } catch {
    return UNAVAILABLE;
  }
  if (reply?.status === "cancelled") return { kind: "cancelled" };
  if (reply?.status === "signed-in" && isText(reply.idToken) && isText(reply.nonce)) {
    return { kind: "signed-in", idToken: reply.idToken, nonce: reply.nonce };
  }
  return UNAVAILABLE;
}

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
