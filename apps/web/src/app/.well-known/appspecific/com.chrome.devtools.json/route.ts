import { NextResponse } from "next/server";

export const dynamic = "force-static";

/** Chrome DevTools probes this path; avoid noisy 404s in dev logs. */
export function GET() {
  return NextResponse.json({});
}
