import { NextResponse } from "next/server";
import { jsonBodyError } from "@/lib/format-error";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 10_000;

function serverOrigin(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.origin;
  } catch {
    throw new Error("Mattermost server URL must be a valid http(s) URL.");
  }
}

export async function POST(request: Request) {
  let body: {
    serverUrl?: string;
    loginId?: string;
    password?: string;
    mfaToken?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch (err) {
    return NextResponse.json({ error: jsonBodyError(err) }, { status: 400 });
  }

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

  let origin: string;
  try {
    origin = serverOrigin(serverUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid server URL.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    const res = await fetch(`${origin}/api/v4/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login_id: loginId,
        password,
        ...(mfaToken ? { token: mfaToken } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      if (res.status === 401) {
        return NextResponse.json(
          { error: "Mattermost rejected those credentials. Check your username, password and MFA code." },
          { status: 401 },
        );
      }
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Mattermost sign-in failed (${res.status}). ${detail}`.trim() },
        { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
      );
    }

    const token = res.headers.get("Token");
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
