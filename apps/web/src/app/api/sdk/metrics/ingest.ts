import { NextResponse } from "next/server";
import { planSeriesIngest } from "@weaveforge/core";
import type { ApiCaller } from "../_shared";
import { MAX_POINTS_PER_REQUEST, MAX_SERIES_PER_REQUEST } from "./limits";
import { formatErrorForResponse } from "@/lib/format-error";

export type SdkDb = ApiCaller["db"];

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

/** Validate, downsample and store one SDK metrics batch (the body of `POST`). */
export async function ingestMetrics(db: SdkDb, body: unknown): Promise<NextResponse> {
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
    // A failed read is not "new series": guessing would skip the stale-tip
    // cleanup and downsample against the wrong maximum.
    const stored = await highestStoredStep(db, experimentId, metric);
    if ("error" in stored) {
      return NextResponse.json({ error: formatErrorForResponse(stored.error, "sdk-metrics") }, { status: 500 });
    }
    const { keep, supersededTipStep } = planSeriesIngest(normalised, stored.step);

    toInsert.push(...keep);
    if (supersededTipStep !== null) {
      staleTips.push({ experimentId, metric, step: supersededTipStep });
    }
  }

  if (toInsert.length > 0) {
    const { error } = await db.from("experiment_metrics").insert(toInsert);
    // A refusal here is usually the ownership policy from migration 0126 (the
    // caller does not own the experiment) — a `42501` whose raw text names the
    // table. Sanitised, with the code kept so the SDK caller can tell a policy
    // refusal from a validation error.
    if (error) return NextResponse.json({ error: formatErrorForResponse(error, "sdk-metrics") }, { status: 500 });
  }

  // After the insert, so a failure above leaves the stored curve untouched.
  // The points are already stored, so a failed cleanup only leaves one extra
  // row behind (the prune script removes it later): log it, keep the 200.
  for (const tip of staleTips) {
    const { error } = await db
      .from("experiment_metrics")
      .delete()
      .eq("experiment_id", tip.experimentId)
      .eq("metric", tip.metric)
      .eq("step", tip.step);
    if (error) console.warn(`[sdk-metrics] stale tip delete failed for step ${tip.step}:`, error);
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
    await db
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
): Promise<{ step: number | null } | { error: unknown }> {
  const { data, error } = await db
    .from("experiment_metrics")
    .select("step")
    .eq("experiment_id", experimentId)
    .eq("metric", metric)
    .order("step", { ascending: false })
    .limit(1);
  if (error) return { error };
  if (!data || data.length === 0) return { step: null };
  const step = Number((data[0] as { step?: unknown }).step);
  return { step: Number.isFinite(step) ? step : null };
}
