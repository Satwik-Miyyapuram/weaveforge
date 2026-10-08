import { NextResponse } from "next/server";
import { jsonBodyError } from "@/lib/format-error";
import { mattermostLogin, type MattermostLoginInput } from "./_login";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: MattermostLoginInput;
  try {
    body = (await request.json()) as MattermostLoginInput;
  } catch (err) {
    return NextResponse.json({ error: jsonBodyError(err) }, { status: 400 });
  }
  return mattermostLogin(body);
}
