import { NextResponse } from "next/server";
import { requireSdkUser } from "../_shared";
import { describeSdkUser } from "./describe-user";

export async function GET(request: Request) {
  const user = await requireSdkUser(request);
  if (!user.ok) return user.response;
  return NextResponse.json(await describeSdkUser(user.db, user.userId));
}
