import type { SupabaseClient } from "@supabase/supabase-js";
import type { LocalFirstBlobStore } from "./local-first-blob-store";
import type { LocalQuery } from "./pglite-client";

const ARTIFACT_PREFIX = "app://artifacts/";
const ARTIFACT_BUCKET = "experiment-artifacts";
const BATCH = 1000;
export const EXPERIMENT_PUSH_MS = 30_000;

/**
 * Sends what the desktop SDK API kept on this computer to the server, so a run
 * logged here shows on the web too: metric points (not in the change feed) and
 * `app://artifacts/` files, which become storage paths in the synced row.
 */
export class ExperimentPush {
  private running: Promise<void> | null = null;

  constructor(
    private readonly run: LocalQuery,
    private readonly server: SupabaseClient,
    private readonly blobs: LocalFirstBlobStore,
    private readonly accountId: string,
    private readonly fetchLocal: (url: string) => Promise<Blob> = fetchBlob,
    private readonly compress: (blob: Blob) => Promise<Blob> = toWebp,
  ) {}

  push(): Promise<void> {
    this.running ??= this.pushAll().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async pushAll(): Promise<void> {
    await this.pushResets();
    await this.pushMetrics();
    await this.pushArtifacts();
    await this.repairServerArtifacts();
  }

  private async pushResets(): Promise<void> {
    const resets = (await this.run("select experiment_id from local_metric_resets", [])) as { experiment_id: string }[];
    for (const { experiment_id: id } of resets) {
      for (const table of ["experiment_metric_points", "experiment_metric_chunks"]) {
        const { error } = await this.server.from(table).delete().eq("experiment_id", id);
        if (error) throw new Error(error.message);
      }
      await this.run("delete from local_metric_resets where experiment_id = $1", [id]);
    }
  }

  private async pushMetrics(): Promise<void> {
    for (;;) {
      const rows = (await this.run(
        `select m.experiment_id, m.metric, m.step, m.value, m.wall_time
           from experiment_metrics m
           left join local_metric_pushes p on p.experiment_id = m.experiment_id and p.metric = m.metric
          where p.step is null or m.step > p.step
          order by m.experiment_id, m.metric, m.step
          limit ${BATCH}`,
        [],
      )) as MetricRow[];
      if (!rows.length) return;
      const { error } = await this.server
        .from("experiment_metrics")
        .insert(rows.map((r) => ({ ...r, user_id: this.accountId })));
      if (error) throw new Error(error.message);
      const tips = new Map<string, MetricRow>();
      for (const r of rows) tips.set(`${r.experiment_id}\u0000${r.metric}`, r);
      for (const r of tips.values()) {
        await this.run(
          `insert into local_metric_pushes (experiment_id, metric, step) values ($1, $2, $3)
           on conflict (experiment_id, metric) do update set step = excluded.step`,
          [r.experiment_id, r.metric, r.step],
        );
      }
      if (rows.length < BATCH) return;
    }
  }

  private async pushArtifacts(): Promise<void> {
    const rows = (await this.run(
      "select id, artifacts from experiments where artifacts::text like '%app://artifacts/%'",
      [],
    )) as { id: string; artifacts: unknown }[];
    for (const row of rows) {
      const list = typeof row.artifacts === "string" ? (JSON.parse(row.artifacts) as unknown) : row.artifacts;
      if (!Array.isArray(list)) continue;
      const next: unknown[] = [];
      for (const entry of list) {
        const rest = typeof entry === "string" && entry.startsWith(ARTIFACT_PREFIX) ? entry.slice(ARTIFACT_PREFIX.length) : null;
        if (!rest) {
          next.push(entry);
          continue;
        }
        // `{experimentId}/{uuid}/{name}` keeps its uuid, so a re-run is the same path.
        const raw = await this.fetchLocal(entry as string);
        const blob = await this.compress(raw);
        const name = blob === raw ? rest : rest.replace(/\.(png|jpe?g)$/i, ".webp");
        const path = `${this.accountId}/${name}`;
        await this.blobs.upload(ARTIFACT_BUCKET, path, blob, blob.type);
        next.push(path);
      }
      // Raw local writes skip the outbox, so the server row is set here too.
      const { error } = await this.server.from("experiments").update({ artifacts: next }).eq("id", row.id);
      if (error) throw new Error(error.message);
      await this.run("update experiments set artifacts = $2::jsonb where id = $1", [row.id, JSON.stringify(next)]);
    }
  }

  // Builds before this fix rewrote only the local row; send those paths up once.
  private async repairServerArtifacts(): Promise<void> {
    const local = (await this.run(
      "select id, artifacts from experiments where artifacts::text like $1",
      [`%"${this.accountId}/%`],
    )) as { id: string; artifacts: unknown }[];
    if (!local.length) return;
    const { data, error } = await this.server
      .from("experiments")
      .select("id, artifacts")
      .in("id", local.map((r) => r.id));
    if (error) throw new Error(error.message);
    const stale = new Set(
      ((data ?? []) as { id: string; artifacts: unknown }[])
        .filter((r) => JSON.stringify(r.artifacts ?? null).includes(ARTIFACT_PREFIX))
        .map((r) => r.id),
    );
    for (const row of local) {
      if (!stale.has(row.id)) continue;
      const artifacts = typeof row.artifacts === "string" ? (JSON.parse(row.artifacts) as unknown) : row.artifacts;
      const { error: e } = await this.server.from("experiments").update({ artifacts }).eq("id", row.id);
      if (e) throw new Error(e.message);
    }
  }
}

interface MetricRow {
  experiment_id: string;
  metric: string;
  step: number;
  value: number;
  wall_time: string | null;
}

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.blob();
}

// Server copy of png/jpg goes up as webp; svg and other files stay as they are.
export async function toWebp(blob: Blob): Promise<Blob> {
  if (!/^image\/(png|jpeg)$/.test(blob.type) || typeof OffscreenCanvas === "undefined") return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const webp = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
    return webp.type === "image/webp" && webp.size < blob.size ? webp : blob;
  } catch {
    return blob;
  }
}

/** Push on a timer and when the network comes back; failures wait for the next turn. */
export function keepPushing(push: ExperimentPush): () => void {
  if (typeof window === "undefined") return () => undefined;
  const go = () => void push.push().catch(() => undefined);
  window.addEventListener("online", go);
  const timer = window.setInterval(go, EXPERIMENT_PUSH_MS);
  go();
  return () => {
    window.removeEventListener("online", go);
    window.clearInterval(timer);
  };
}
