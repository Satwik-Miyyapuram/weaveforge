import { NextResponse } from "next/server";

/** Chrome DevTools probes this path; avoid noisy 404s in dev logs. */
export function GET() {
  return NextResponse.json({});
}
