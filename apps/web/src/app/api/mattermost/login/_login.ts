import { NextResponse } from "next/server";
import { checkUrlReachable, pinnedFetch } from "@/backend/net/safe-fetch";

const TIMEOUT_MS = 10_000;

export interface MattermostLoginInput {
  serverUrl?: string;
  loginId?: string;
  password?: string;
  mfaToken?: string;
}

function loginUrl(serverUrl: string): URL {
  try {
    const url = new URL(serverUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return new URL("/api/v4/users/login", url.origin);
  } catch {
    throw new Error("Mattermost server URL must be a valid http(s) URL.");
  }
}

/** Signs in on the pinned path: private and internal addresses are refused, so the route cannot be aimed inward. */
export async function mattermostLogin(
  body: MattermostLoginInput,
  resolve?: (hostname: string) => Promise<string[]>,
): Promise<Response> {
  const serverUrl = body.serverUrl?.trim();
  const loginId = body.loginId?.trim();
  const password = body.password;
  const mfaToken = body.mfaToken?.trim();

  if (!serverUrl) {
    return NextResponse.json({ error: "Mattermost server URL is required." }, { status: 400 });
  }
  if (!loginId) {
    return NextResponse.json({ error: "Username or email is required." }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ error: "Password is required." }, { status: 400 });
  }

  let url: URL;
  try {
    url = loginUrl(serverUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid server URL.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const reachable = await checkUrlReachable(url, resolve);
  if (!reachable.ok) {
    return NextResponse.json({ error: reachable.message }, { status: reachable.status });
  }

  try {
    const res = await pinnedFetch({
      url,
      address: reachable.address,
      family: reachable.family,
      timeoutMs: TIMEOUT_MS,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        login_id: loginId,
        password,
        ...(mfaToken ? { token: mfaToken } : {}),
      }),
    });

    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      if (res.status === 401) {
        return NextResponse.json(
          { error: "Mattermost rejected those credentials. Check your username, password and MFA code." },
          { status: 401 },
        );
      }
      return NextResponse.json(
        { error: `Mattermost sign-in failed (${res.status}).` },
        { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
      );
    }

    const token = res.headers.get("Token");
    await res.body?.cancel().catch(() => {});
    if (!token) {
      return NextResponse.json(
        { error: "Signed in, but Mattermost did not return a session token." },
        { status: 502 },
      );
    }

    return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to reach the Mattermost server." }, { status: 502 });
  }
}
