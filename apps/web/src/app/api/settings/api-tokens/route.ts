import { NextResponse } from "next/server";
import { isExpiryDays } from "@/features/settings/infrastructure/api-token-crypto";
import { apiTokenService } from "@/features/settings/infrastructure/api-token-service";
import { bearerToken } from "@/lib/bearer-token";
import { formatError, formatErrorForResponse, jsonBodyError } from "@/lib/format-error";

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
    return NextResponse.json({ error: status === 500 ? formatErrorForResponse(err, "api-tokens") : message }, { status });
  }
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return authError("Not authenticated.");

  let body: { name?: string; expiresInDays?: number | null };
  try {
    body = (await request.json()) as { name?: string; expiresInDays?: number | null };
  } catch (err) {
    return NextResponse.json({ error: jsonBodyError(err) }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected a JSON object body." }, { status: 400 });
  }
  if (!isExpiryDays(body.expiresInDays)) {
    return NextResponse.json(
      { error: "expiresInDays must be a whole number of days (0 to 36500), or null." },
      { status: 400 },
    );
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
    return NextResponse.json({ error: status === 500 ? formatErrorForResponse(err, "api-tokens") : message }, { status });
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
    return NextResponse.json({ error: status === 500 ? formatErrorForResponse(err, "api-tokens") : message }, { status });
  }
}
