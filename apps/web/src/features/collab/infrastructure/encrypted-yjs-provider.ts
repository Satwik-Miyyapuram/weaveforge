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
}

export class EncryptedYjsProvider {
  private readonly channel: RealtimeChannel;
  private pending: Uint8Array[] = [];
  private mergeTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPersistedId = 0;
  private destroyed = false;
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
    void db.realtime.setAuth().then(() => this.channel.subscribe());
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
    await this.channel.send({ type: "broadcast", event: "yjs", payload: { data } });
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
  }

  private async persistTail() {
    this.persistTimer = null;
    if (this.destroyed) return;
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
    await this.persistTail();
    await this.maybeCompact();
    if (this.opts.awareness && this.awarenessHandler) {
      this.opts.awareness.off("update", this.awarenessHandler);
      removeAwarenessStates(this.opts.awareness, [this.opts.doc.clientID], this);
    }
    void this.channel.unsubscribe();
  }
}
