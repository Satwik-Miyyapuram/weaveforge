import { NextResponse } from "next/server";
import { requireSdkUser } from "../_shared";

export async function GET(request: Request) {
  const user = await requireSdkUser(request);
  if (!user.ok) return user.response;

  const { data: profile } = await user.db
    .from("profiles")
    .select("email, full_name")
    .eq("user_id", user.userId)
    .maybeSingle();

  return NextResponse.json({
    userId: user.userId,
    email: profile?.email ?? null,
    fullName: profile?.full_name ?? null,
  });
}

