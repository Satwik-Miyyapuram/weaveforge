import { requireSdkUser } from "@/app/api/sdk/_shared";
import { linkedReportContent } from "./_content";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  return linkedReportContent(auth, id);
}
