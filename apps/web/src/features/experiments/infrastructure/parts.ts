import { projectUserCtx, rustRepository } from "@/backend/providers/postgrest/rust-repository";
import type { ProjectContext } from "@/lib/parts-2";
import { readyCore } from "@/lib/rust-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IBlobStore,
  Experiment,
  ICurrentUserProvider,
  IExperimentManager,
  IExperimentRepository,
  IMetricRepository,
} from "@weaveforge/core";

// --- experiment-artifact-store ---
const BUCKET = "experiment-artifacts";
const SIGNED_TTL_S = 3600;

/**
 * Signs experiment artifacts for viewing.
 *
 * `experiments.artifacts` holds two kinds of entry, and they have to keep
 * working side by side:
 *
 *   - a **storage path** (`{userId}/{experimentId}/{name}`) written by
 *     `log_bytes` through `/api/sdk/artifacts`
 *   - an **absolute URL** written by `log_artifact(url)`, which exists so a run
 *     can point at something already hosted elsewhere — a wandb run, an S3
 *     object
 *
 * Only the first kind is ours to sign. Telling them apart by "does this parse
 * as an absolute URL" is the whole rule.
 *
 * Paths are stored rather than signed URLs because a presigned URL is a
 * credential with an expiry, and SigV4 caps that at seven days no matter what
 * you ask for. Storing one as though it were an address gives you a link that
 * works all week and then serves an XML error forever.
 */
export class ExperimentArtifactStore {
  constructor(
    private readonly blobs: IBlobStore,
    private readonly session: ICurrentUserProvider,
  ) {}

  /**
   * Store one file a person attached, and return the entry to record.
   *
   * The key is `{userId}/{experimentId}/{uuid}/{name}`: the user id first
   * because that is what RLS reads, and a uuid directory rather than a uuid
   * filename so two figures called `loss.png` can both exist while the name
   * shown under each stays the one their author gave it.
   */
  async upload(experimentId: string, file: File): Promise<string> {
    const userId = await this.session.requireUserId();
    const path = `${userId}/${experimentId}/${crypto.randomUUID()}/${readyCore().safeName(file.name)}`;
    await this.blobs.upload(BUCKET, path, file, file.type || "application/octet-stream");
    return path;
  }

  /**
   * Resolve entries to viewable URLs, in the order given.
   *
   * Absolute URLs pass through untouched; storage paths are signed for an hour.
   * A path that cannot be signed comes back `null` so the caller can leave a
   * gap rather than render a broken image.
   */
  async viewUrls(entries: readonly string[]): Promise<(string | null)[]> {
    const paths = entries.filter((entry) => !readyCore().isAbsoluteUrl(entry));
    const signed = paths.length ? await this.blobs.signedUrls(BUCKET, paths, SIGNED_TTL_S) : [];

    const byPath = new Map(paths.map((path, index) => [path, signed[index] ?? null]));
    return entries.map((entry) =>
      readyCore().isAbsoluteUrl(entry) ? readyCore().viewableArtifactUrl(entry, isTauriShell()) : (byPath.get(entry) ?? null),
    );
  }
}

/** True inside the Tauri shell, which defines `__TAURI_INTERNALS__` on the page. */
export function isTauriShell(scope: object = globalThis): boolean {
  return "__TAURI_INTERNALS__" in scope;
}

// --- experiment-repository ---
/**
 * `experiments` through the Rust step engine (`crates/wf-core/src/repos/experiments.rs`),
 * scoped to the open project. `listByIds` is the batch read the facades duck-type.
 */
/** An experiment repository with the batch read the sharing facades duck-type. */
export type RustExperimentRepository = IExperimentRepository &
  IExperimentManager & {
    listByIds(ids: readonly string[]): Promise<Experiment[]>;
  };

export function rustExperimentRepository(db: SupabaseClient, project: ProjectContext): RustExperimentRepository {
  const repo = rustRepository<RustExperimentRepository>(
    db,
    "experiments",
    [
      "getById",
      "listByIds",
      "list",
      "save",
      "patch",
      "delete",
      "add",
      "setStatus",
      "recordMetrics",
      "addArtifacts",
      "setResultNote",
      "remove",
    ],
    projectUserCtx(project),
  );
  // JSON drops undefined keys; a field patched to undefined is a clear, so send null.
  const patch = repo.patch.bind(repo);
  repo.patch = (id, fields) =>
    patch(id, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v ?? null])) as typeof fields);
  return repo;
}

// --- metric-repository ---
/**
 * `experiment_metrics` curve data through the Rust step engine
 * (`crates/wf-core/src/repos/experiment_metrics.rs`). Writes go to the view, whose
 * `INSTEAD OF INSERT` trigger routes them into the row table; history is downsampled
 * by `metric_history`. Rust returns `latestActivityAt` as `[id, ms]` pairs.
 */
export function rustMetricRepository(db: SupabaseClient): IMetricRepository {
  type Wire = Omit<IMetricRepository, "latestActivityAt"> & {
    latestActivityAt(experimentIds: readonly string[]): Promise<[string, number][]>;
  };
  const repo = rustRepository<Wire>(db, "experiment_metrics", ["append", "history", "latestActivityAt"]);
  return {
    ...repo,
    latestActivityAt: async (ids) => new Map(await repo.latestActivityAt(ids)),
  };
}
