import { NextResponse } from "next/server";
import { apiTokenService } from "@/features/settings/infrastructure/api-token-service";
import { bearerToken } from "@/lib/bearer-token";
import { formatError } from "@/lib/format-error";

function authError(message: string, status = 401) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const token = bearerToken(request);
  if (!token) return authError("Not authenticated.");

  try {
    const svc = apiTokenService();
    const tokens = await svc.listTokens(token);
    return NextResponse.json({ tokens });
  } catch (err) {
    const message = formatError(err);
    const status = message === "Invalid session." ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return authError("Not authenticated.");

  let body: { name?: string; expiresInDays?: number | null };
  try {
    body = (await request.json()) as { name?: string; expiresInDays?: number | null };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const svc = apiTokenService();
    const created = await svc.createToken(token, body.name ?? "", body.expiresInDays);
    return NextResponse.json(created);
  } catch (err) {
    const message = formatError(err);
    const status =
      message === "Invalid session."
        ? 401
        : message === "Token name is required."
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  const token = bearerToken(request);
  if (!token) return authError("Not authenticated.");

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Token id required." }, { status: 400 });

  try {
    const svc = apiTokenService();
    await svc.revokeToken(token, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = formatError(err);
    const status =
      message === "Invalid session."
        ? 401
        : message === "Token not found."
          ? 404
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
