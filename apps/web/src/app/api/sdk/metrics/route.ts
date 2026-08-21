import { NextResponse } from "next/server";
import { planSeriesIngest } from "@weaveforge/core";
import { requireSdkUser } from "../_shared";
import { MAX_POINTS_PER_REQUEST, MAX_SERIES_PER_REQUEST } from "./limits";

type SdkDb = Extract<Awaited<ReturnType<typeof requireSdkUser>>, { ok: true }>["db"];

interface IncomingPoint {
  experiment_id?: string;
  metric?: string;
  step?: number;
  [key: string]: unknown;
}

/**
 * One curve. Points are only comparable for downsampling within a series.
 *
 * NUL as the separator because a metric name is arbitrary user text and a UUID
 * is not: any printable delimiter could appear inside a name and collapse two
 * different series into one bucket.
 */
function seriesKey(p: IncomingPoint): string {
  return `${p.experiment_id ?? ""}\u0000${p.metric ?? ""}`;
}

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
  if (points.length > MAX_POINTS_PER_REQUEST) {
    return NextResponse.json(
      { error: `At most ${MAX_POINTS_PER_REQUEST} points per request.` },
      { status: 400 },
    );
  }

  // Downsample before writing (Fix C of the metrics storage plan).
  //
  // Here rather than in the SDK because the SDK is not the only writer and a
  // client-side budget is advisory. It is still not the last word — anything
  // writing straight to PostgREST bypasses this route entirely — so
  // `scripts/prune-metric-series.mjs` applies the identical predicate as a
  // backstop over what is already stored.
  const grouped = new Map<string, IncomingPoint[]>();
  for (const raw of points as IncomingPoint[]) {
    const key = seriesKey(raw);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(raw);
    else grouped.set(key, [raw]);
  }
  if (grouped.size > MAX_SERIES_PER_REQUEST) {
    return NextResponse.json(
      { error: `At most ${MAX_SERIES_PER_REQUEST} distinct series per request.` },
      { status: 400 },
    );
  }

  const toInsert: IncomingPoint[] = [];
  /** Off-grid tips left behind by an earlier batch, one per series at most. */
  const staleTips: { experimentId: string; metric: string; step: number }[] = [];

  for (const bucket of grouped.values()) {
    const first = bucket[0]!;
    const experimentId = first.experiment_id;
    const metric = first.metric;

    // Unattributed points cannot be grouped into a series, so they cannot be
    // downsampled either. Pass them through and let the database reject them.
    if (!experimentId || !metric) {
      toInsert.push(...bucket);
      continue;
    }

    // An omitted step means the first one; anything else that is not a number
    // has to be refused rather than coerced. `Number("x")` is NaN, and NaN
    // compares false against every grid test, so such a point would be dropped
    // by the downsampler without the caller ever being told.
    const normalised: (IncomingPoint & { step: number })[] = [];
    for (const p of bucket) {
      const step = Number(p.step ?? 0);
      if (!Number.isFinite(step)) {
        return NextResponse.json(
          { error: `Point step must be a finite number, got ${JSON.stringify(p.step)}.` },
          { status: 400 },
        );
      }
      normalised.push({ ...p, step });
    }
    const previousMaxStep = await highestStoredStep(user.db, experimentId, metric);
    const { keep, supersededTipStep } = planSeriesIngest(normalised, previousMaxStep);

    toInsert.push(...keep);
    if (supersededTipStep !== null) {
      staleTips.push({ experimentId, metric, step: supersededTipStep });
    }
  }

  if (toInsert.length > 0) {
    const { error } = await user.db.from("experiment_metrics").insert(toInsert);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // After the insert, so a failure above leaves the stored curve untouched.
  for (const tip of staleTips) {
    await user.db
      .from("experiment_metrics")
      .delete()
      .eq("experiment_id", tip.experimentId)
      .eq("metric", tip.metric)
      .eq("step", tip.step);
  }

  const expIds = [
    ...new Set(
      (points as IncomingPoint[])
        .map((p) => p.experiment_id?.trim())
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

  // `stored` is deliberately reported: a caller that sent 1000 points and sees
  // 250 stored should be able to tell that downsampling did it, not a bug.
  return NextResponse.json({ ok: true, received: points.length, stored: toInsert.length });
}

/**
 * The highest step already stored for a series, or null when it is new.
 *
 * One round trip per series per batch — with the SDK flushing 1000 points
 * across a handful of metrics that is a few reads per flush, against an index
 * whose leading columns are exactly `(experiment_id, metric_id)`.
 */
async function highestStoredStep(
  db: SdkDb,
  experimentId: string,
  metric: string,
): Promise<number | null> {
  const { data, error } = await db
    .from("experiment_metrics")
    .select("step")
    .eq("experiment_id", experimentId)
    .eq("metric", metric)
    .order("step", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const step = Number((data[0] as { step?: unknown }).step);
  return Number.isFinite(step) ? step : null;
}
