import { NextResponse } from "next/server";
import { requireSdkUser } from "../_shared";

export async function POST(request: Request) {
  const user = await requireSdkUser(request);
  if (!user.ok) return user.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const points = (body as { points?: unknown }).points;
  if (!Array.isArray(points)) {
    return NextResponse.json({ error: "Body must be { points: [...] }." }, { status: 400 });
  }
  if (points.length === 0) return NextResponse.json({ ok: true });

  const { error } = await user.db.from("experiment_metrics").insert(points);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const expIds = [
    ...new Set(
      points
        .map((p) => (p as { experiment_id?: string }).experiment_id?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (expIds.length > 0) {
    const now = new Date().toISOString();
    // Heartbeat: metric streams keep the run alive; revive wrongly-abandoned live SDK runs.
    await user.db
      .from("experiments")
      .update({ started_at: now, status: "running" })
      .in("id", expIds)
      .in("status", ["running", "abandoned"]);
  }

  return NextResponse.json({ ok: true });
}
