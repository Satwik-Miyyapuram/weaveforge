/**
 * Experiments as `experiments/<slug>--<id>.experiment.md` files (0.9.7 L3). Same
 * contract as the `experiments` PostgREST repo; laws in test/file-experiment-repo.test.ts.
 */
import {
  ExperimentValidationError,
  NotFoundError,
  type Experiment,
  type ExperimentFilter,
  type ExperimentPatch,
  type ExperimentStatus,
  type IExperimentManager,
  type IExperimentRepository,
  type IWorkspaceFs,
  type NewExperimentInput,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import { FileEntityStore, moveToTrash, type ProjectRoot } from "./file-entity-store";

/** `patch` semantics: a key present with `undefined` clears the field. */
function applyPatch(current: Experiment, fields: ExperimentPatch): Experiment {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as unknown as Experiment;
}

export class FileExperimentRepository implements IExperimentRepository, IExperimentManager {
  private readonly store: FileEntityStore<Experiment>;

  constructor(
    private readonly fs: IWorkspaceFs,
    root: ProjectRoot,
  ) {
    this.store = new FileEntityStore<Experiment>(fs, root, "experiment");
  }

  getById(id: string): Promise<Experiment | null> {
    return this.store.get(id);
  }

  async list(filter: ExperimentFilter = {}): Promise<Experiment[]> {
    const needle = filter.nameContains?.toLowerCase();
    return (await this.store.all())
      .filter(
        (e) =>
          (!filter.status || e.status === filter.status) &&
          (!filter.relatedPaper || e.relatedPaper === filter.relatedPaper) &&
          (!needle || e.name.toLowerCase().includes(needle)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  save(experiment: Experiment): Promise<void> {
    return this.store.save(experiment);
  }

  delete(id: string): Promise<void> {
    return this.remove(id);
  }

  async patch(id: string, fields: ExperimentPatch): Promise<void> {
    await this.update(id, (current) => applyPatch(current, fields));
  }

  async add(input: NewExperimentInput): Promise<Experiment> {
    let made: Experiment;
    try {
      // The wasm binding's `B.Experiment` marks every field optional; the codec fills them all.
      made = readyCore().createExperimentWith(
        input,
        crypto.randomUUID(),
        new Date().toISOString(),
      ) as unknown as Experiment;
    } catch (error) {
      throw new ExperimentValidationError(error instanceof Error ? error.message : String(error));
    }
    await this.store.save(made);
    return made;
  }

  setStatus(id: string, status: ExperimentStatus): Promise<Experiment> {
    return this.update(id, (current) => {
      const timing = readyCore().statusPatchForExperiment(current, status, new Date().toISOString());
      // An absent timestamp in the patch clears it.
      return applyPatch(current, {
        status: timing.status as ExperimentStatus,
        startedAt: (timing.startedAt as string | null | undefined) ?? undefined,
        finishedAt: (timing.finishedAt as string | null | undefined) ?? undefined,
      });
    });
  }

  recordMetrics(id: string, metrics: Record<string, unknown>): Promise<Experiment> {
    return this.update(id, (current) => ({ ...current, metrics: { ...current.metrics, ...metrics } }));
  }

  addArtifacts(id: string, entries: readonly string[]): Promise<Experiment> {
    return this.update(id, (current) => ({
      ...current,
      artifacts: [...new Set([...current.artifacts, ...entries])],
    }));
  }

  setResultNote(id: string, note: string): Promise<Experiment> {
    const trimmed = note.trim();
    return this.update(id, (current) => applyPatch(current, { resultNote: trimmed || undefined }));
  }

  /** Trashes the file and the folder beside it (`metrics/`), file by file, so nothing is unlinked. */
  async remove(id: string): Promise<void> {
    const found = await this.store.find(id);
    if (!found) return;
    const folder = found.path.replace(/\.md$/, "");
    const inside: string[] = [];
    if (await this.fs.stat(folder)) for await (const e of this.fs.walk(folder)) if (e.kind === "file") inside.push(e.path);
    await moveToTrash(this.fs, found.path);
    for (const path of inside) await moveToTrash(this.fs, path);
  }

  private async update(id: string, change: (current: Experiment) => Experiment): Promise<Experiment> {
    const current = await this.store.get(id);
    if (!current) throw new NotFoundError(`No experiment with id "${id}".`);
    const next = change(current);
    await this.store.save(next);
    return next;
  }
}
