import { NextResponse } from "next/server";
import { requireSdkUser } from "../_shared";

const BUCKET = "experiment-artifacts";
const EXPIRES_IN = 10 * 365 * 24 * 3600;

export async function POST(request: Request) {
  const user = await requireSdkUser(request);
  if (!user.ok) return user.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { experimentId, name, contentType, dataBase64 } = body as any;
  if (!experimentId || !name || !dataBase64) {
    return NextResponse.json(
      { error: "Body must include experimentId, name, dataBase64." },
      { status: 400 },
    );
  }
  const path = `${user.userId}/${experimentId}/${name}`;
  const bytes = Buffer.from(String(dataBase64), "base64");

  const bucket = user.db.storage.from(BUCKET);
  const { error: upErr } = await bucket.upload(path, bytes, {
    contentType: contentType || "application/octet-stream",
    upsert: true,
  });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: signed, error: signErr } = await bucket.createSignedUrl(path, EXPIRES_IN);
  if (signErr) return NextResponse.json({ error: signErr.message }, { status: 500 });
  return NextResponse.json({ url: signed?.signedUrl ?? path, path });
}

