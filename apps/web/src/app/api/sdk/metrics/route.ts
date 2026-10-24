import { NextResponse } from "next/server";
import { requireSdkUser } from "../_shared";
import { ingestMetrics } from "./ingest";
import { formatErrorForResponse } from "@/lib/format-error";

export async function POST(request: Request) {
  const user = await requireSdkUser(request);
  if (!user.ok) return user.response;
  return ingestMetrics(user.db, await request.json().catch(() => null));
}

/** Drops one run's stored curves, so a run re-used by key starts empty. RLS keeps it to your rows. */
export async function DELETE(request: Request) {
  const user = await requireSdkUser(request);
  if (!user.ok) return user.response;
  const id = new URL(request.url).searchParams.get("experiment_id")?.trim();
  if (!id) return NextResponse.json({ error: "Missing experiment_id." }, { status: 400 });
  for (const table of ["experiment_metric_points", "experiment_metric_chunks"] as const) {
    const { error } = await user.db.from(table).delete().eq("experiment_id", id);
    if (error) return NextResponse.json({ error: formatErrorForResponse(error, "sdk-metrics") }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
