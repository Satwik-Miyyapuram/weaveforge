import type { ApiCaller } from "../_shared";

export type SdkWhoami = { userId: string; email: string | null; fullName: string | null };

/**
 * Who the token belongs to. The SDK connects on `userId` alone, so a failed
 * profile read is logged and answered with null names instead of a 500.
 */
export async function describeSdkUser(db: ApiCaller["db"], userId: string): Promise<SdkWhoami> {
  const { data: profile, error } = await db
    .from("profiles")
    .select("email, full_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) console.warn("[sdk-whoami] profile read failed:", error);
  return {
    userId,
    email: (profile?.email as string | undefined) ?? null,
    fullName: (profile?.full_name as string | undefined) ?? null,
  };
}
