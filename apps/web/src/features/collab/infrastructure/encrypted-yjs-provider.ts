/**
 * Yjs transport over Supabase Realtime broadcast (plan §7.3).
 * CRDT payloads are stored and broadcast as plaintext bytes (RLS + at-rest).
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRealtimeClient } from "@/backend/providers/supabase/client";
import type { CompactCrdtLogUseCase, ICrdtUpdateStore } from "@weaveforge/core";
import type { Awareness } from "y-protocols/awareness";
import { applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as Y from "yjs";
import { mergeUpdates, encodeStateAsUpdate } from "yjs";

const MERGE_MS = 200;
const PERSIST_IDLE_MS = 5000;
const COMPACT_THRESHOLD = 200;

export interface EncryptedYjsProviderOptions {
  doc: Y.Doc;
  db: unknown;
  crdtStore: ICrdtUpdateStore;
  resourceType: string;
  resourceId: string;
  projectId: string | null;
  authorId: string;
  epoch?: number;
  awareness?: Awareness;
  getSnapshotUpto?: () => Promise<number>;
  setSnapshotUpto?: (uptoId: number) => Promise<void>;
  compactCrdtLog?: CompactCrdtLogUseCase;
  /**
   * Puts the row's stored body into an empty document. Runs *after* the CRDT
   * log is replayed, and only then, because the log already carries the body
   * for every resource that has been co-edited before: seeding up front and
   * replaying on top of it concatenated the two, so every reopen doubled the
   * text. The callback is responsible for its own "is the doc still empty"
   * check — see `CollaborativeMarkdownEditor`.
   */
  seed?: () => void;
  /** Surfaces transport failures that are otherwise silent. */
  onError?: (stage: string, detail: string) => void;
  /** Fires on every successful join, so a stale failure notice can be cleared. */
  onConnected?: () => void;
}

export class EncryptedYjsProvider {
  private readonly channel: RealtimeChannel;
  private pending: Uint8Array[] = [];
  private mergeTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPersistedId = 0;
  private destroyed = false;
  private subscribed = false;
  private awarenessHandler: ((payload: { added: number[]; updated: number[]; removed: number[] }) => void) | null =
    null;

  constructor(private readonly opts: EncryptedYjsProviderOptions) {
    // The socket, which after a cutover is not the same host as the data API.
    const db = getRealtimeClient(opts.db as SupabaseClient);
    this.channel = db.channel(`crdt:${opts.resourceType}:${opts.resourceId}`, {
      config: { broadcast: { self: false }, private: true },
    });
    this.channel.on("broadcast", { event: "yjs" }, ({ payload }) => {
      void this.onRemote(payload as { data?: string });
    });
    this.channel.on("broadcast", { event: "awareness" }, ({ payload }) => {
      void this.onAwarenessRemote(payload as { data?: string });
    });
    // Token first, then join — see the note in `project-lww-invalidator`.
    void db.realtime
      .setAuth()
      .then(() =>
        this.channel.subscribe((status, err) => {
          this.subscribed = status === "SUBSCRIBED";
          if (process.env.NODE_ENV !== "production") {
            console.debug(`[collab] ${this.channel.topic} → ${status}${err ? `: ${err.message}` : ""}`);
          }
          if (this.destroyed) return;
          if (status === "SUBSCRIBED") this.opts.onConnected?.();
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            this.opts.onError?.("subscribe", `${status}${err ? `: ${err.message}` : ""}`);
          }
        }),
      )
      .catch((err) => this.opts.onError?.("setAuth", err instanceof Error ? err.message : String(err)));
    opts.doc.on("update", this.onLocalUpdate);
    if (opts.awareness) this.bindAwareness(opts.awareness);
    void this.bootstrapFromStore();
  }

  private bindAwareness(awareness: Awareness) {
    this.awarenessHandler = ({ added, updated, removed }) => {
      const changed = added.concat(updated, removed);
      const update = encodeAwarenessUpdate(awareness, changed);
      const data = btoa(String.fromCharCode(...update));
      void this.channel.send({ type: "broadcast", event: "awareness", payload: { data } });
    };
    awareness.on("update", this.awarenessHandler);
  }

  private onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    this.pending.push(update);
    if (this.mergeTimer) return;
    this.mergeTimer = setTimeout(() => void this.flushOutbound(), MERGE_MS);
    if (!this.persistTimer) {
      this.persistTimer = setTimeout(() => void this.persistTail(), PERSIST_IDLE_MS);
    }
  };

  private async flushOutbound() {
    this.mergeTimer = null;
    if (this.pending.length === 0 || this.destroyed) return;
    const merged = mergeUpdates(this.pending);
    this.pending = [];
    const data = btoa(String.fromCharCode(...merged));
    try {
      const res = await this.channel.send({ type: "broadcast", event: "yjs", payload: { data } });
      if (res !== "ok") this.opts.onError?.("send", `broadcast returned ${String(res)}`);
    } catch (err) {
      this.opts.onError?.("send", err instanceof Error ? err.message : String(err));
    }
  }

  private async onRemote(payload: { data?: string }) {
    if (!payload.data || this.destroyed) return;
    const bin = Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0));
    Y.applyUpdate(this.opts.doc, bin, this);
  }

  private async onAwarenessRemote(payload: { data?: string }) {
    if (!payload.data || this.destroyed || !this.opts.awareness) return;
    const bin = Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0));
    applyAwarenessUpdate(this.opts.awareness, bin, this);
  }

  private async bootstrapFromStore() {
    try {
      const snapshotUpto = (await this.opts.getSnapshotUpto?.()) ?? 0;
      this.lastPersistedId = snapshotUpto;
      const rows = await this.opts.crdtStore.listAfter(
        this.opts.resourceType,
        this.opts.resourceId,
        snapshotUpto,
      );
      for (const row of rows) {
        Y.applyUpdate(this.opts.doc, row.payload, this);
        this.lastPersistedId = row.id;
      }
    } catch (err) {
      this.opts.onError?.("bootstrap", err instanceof Error ? err.message : String(err));
    } finally {
      // Always seed, even when the replay failed: an empty editor over a
      // non-empty row would otherwise look like the body had been deleted, and
      // the first keystroke would persist that deletion.
      if (!this.destroyed) this.opts.seed?.();
    }
  }

  /**
   * Write the document's current state to the CRDT log.
   *
   * `force` is what teardown uses. The `destroyed` guard exists to stop the
   * idle timer firing into a provider that has gone away — but `destroy()` sets
   * that flag before it calls this, so the final flush silently did nothing:
   * every edit made since the last idle persist reached the row body (the
   * editor saves that on its own debounce) and never reached the log. Reopening
   * replayed a log that was behind, found a non-empty document so skipped the
   * seed, and showed text older than what had been typed.
   */
  private async persistTail(force = false) {
    this.persistTimer = null;
    if (this.destroyed && !force) return;
    const merged = encodeStateAsUpdate(this.opts.doc);
    const saved = await this.opts.crdtStore.append({
      resourceType: this.opts.resourceType,
      resourceId: this.opts.resourceId,
      projectId: this.opts.projectId,
      epoch: this.opts.epoch ?? 1,
      payload: merged,
      authorId: this.opts.authorId,
    });
    this.lastPersistedId = saved.id;
  }

  private async maybeCompact() {
    if (!this.opts.compactCrdtLog || !this.opts.setSnapshotUpto) return;
    const snapshotUpto = (await this.opts.getSnapshotUpto?.()) ?? 0;
    const tailCount = await this.opts.crdtStore.countAfter(
      this.opts.resourceType,
      this.opts.resourceId,
      snapshotUpto,
    );
    if (tailCount < COMPACT_THRESHOLD || this.lastPersistedId <= snapshotUpto) return;
    await this.opts.compactCrdtLog.execute({
      resourceType: this.opts.resourceType,
      resourceId: this.opts.resourceId,
      snapshotUptoId: this.lastPersistedId,
      setSnapshotUpto: this.opts.setSnapshotUpto,
    });
  }

  async destroy() {
    this.destroyed = true;
    this.opts.doc.off("update", this.onLocalUpdate);
    if (this.mergeTimer) clearTimeout(this.mergeTimer);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    if (this.opts.awareness && this.awarenessHandler) {
      this.opts.awareness.off("update", this.awarenessHandler);
      removeAwarenessStates(this.opts.awareness, [this.opts.doc.clientID], this);
    }

    // Leave the channel *before* the awaits below, in this method's synchronous
    // prologue. Tearing down last meant the `phx_leave` went out after
    // `persistTail`'s round trip — long enough for React to have mounted the
    // replacement editor, which joins the same topic. supabase-js keys channels
    // by topic, so the late leave closed the *new* channel and live sync was
    // dead for the rest of the session while the editor still looked fine.
    //
    // `unsubscribe`, not `removeChannel`: the latter drops the channel from the
    // client's registry, and supabase-js disconnects the shared socket once the
    // registry empties — taking the project-wide invalidation channel with it.
    void this.channel.unsubscribe();

    // Forced: `destroyed` is already true above, and this is the flush that
    // carries the last few seconds of typing into the log.
    await this.persistTail(true);
    await this.maybeCompact();
  }
}
