/** Save bases for editors: one save at a time per note, each based on the body the last one stored. */
import { ConflictError } from "@weaveforge/core";

/**
 * A note's body saves from the workspace, one at a time per note.
 *
 * Each save names the body the store held when it was sent (its base), so the
 * store can tell an edit made elsewhere from this one. Two saves of one note in
 * flight at once both named the body from before either, so the second looked
 * like an overwrite of someone else's edit. Here a save starts once the note's
 * earlier ones have settled, and its base is the body the last one stored (a
 * merged body included). `bases` is the workspace's map of full note bodies.
 */
export class NoteSaves {
  private readonly tails = new Map<string, Promise<unknown>>();

  /** `refuse(id)` true: a new save of `id` is refused (ConflictError) instead of falling back to `loaded`. */
  constructor(
    private readonly bases: Map<string, string>,
    private readonly refuse: (id: string) => boolean = () => false,
  ) {}

  /**
   * Queue `write`, which sends a body against `base` and resolves the body the
   * store then holds. `loaded` is the base when none is known yet: the body the
   * workspace loaded the note with.
   */
  run(id: string, loaded: string | undefined, write: (base: string | undefined) => Promise<string>): Promise<string> {
    if (this.refuse(id)) {
      return Promise.reject(new ConflictError(`${id}: this editor was replaced; not saved. Reload before saving.`));
    }
    const before = this.tails.get(id) ?? Promise.resolve();
    const next = before
      .catch(() => undefined)
      .then(async () => {
        const stored = await write(this.bases.get(id) ?? loaded);
        this.bases.set(id, stored);
        return stored;
      });
    this.tails.set(id, next);
    void next
      .catch(() => undefined)
      .then(() => {
        if (this.tails.get(id) === next) this.tails.delete(id);
      });
    return next;
  }

  /** Resolves once every save of `id` queued so far has settled. */
  settled(id: string): Promise<void> {
    return (this.tails.get(id) ?? Promise.resolve()).then(
      () => undefined,
      () => undefined,
    );
  }
}

/**
 * Save bases for editors that keep their own text across a reload (report sections, log entries).
 *
 * The editor takes its body once, when it mounts, so a save is based on that body (then on what the last
 * save stored), never on text a reload brought in meanwhile: that would overwrite the outside edit. Each
 * mount is a slot, `<tab key>#<n>`. A slot is seeded with the body it was first rendered with. After a
 * refused save the slot keeps its base, so its later saves are refused too, until `reseed` starts a new
 * slot, which the screen uses as the editor's React key to remount it on the reloaded text.
 *
 * A slot two reseeds old is retired: its saves are refused from then on, and its base is dropped once the
 * saves it already queued settle, so a long session does not keep every old body.
 */
export class EditorBases {
  private readonly bases = new Map<string, string>();
  private readonly epochs = new Map<string, number>();
  private readonly retired = new Set<string>();
  readonly saves = new NoteSaves(this.bases, (slot) => this.retired.has(slot));

  /** How many slots hold a base. */
  get size(): number {
    return this.bases.size;
  }

  /** The tab's current slot, seeded with `opened` if it has no base yet. */
  slot(key: string, opened: string): string {
    const slot = `${key}#${this.epochs.get(key) ?? 0}`;
    if (!this.bases.has(slot)) this.bases.set(slot, opened);
    return slot;
  }

  /**
   * Starts a new slot for the tab. The old slot keeps its base: a save the old editor still has queued
   * must be refused, not fall back to the reloaded text. The slot before that one is retired.
   */
  reseed(key: string): void {
    const epoch = (this.epochs.get(key) ?? 0) + 1;
    this.epochs.set(key, epoch);
    if (epoch < 2) return;
    const old = `${key}#${epoch - 2}`;
    this.retired.add(old);
    void this.saves.settled(old).then(() => this.bases.delete(old));
  }
}
