/**
 * Yjs transport over Realtime broadcast (plan §7.3).
 * CRDT payloads are stored and broadcast as plaintext bytes (RLS + at-rest).
 */

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getRealtimeClient } from "@/backend/providers/postgrest/parts-1";
import type { ICrdtUpdateStore } from "@weaveforge/core";
import type { Awareness } from "y-protocols/awareness";
import { applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as Y from "yjs";
import { mergeUpdates, encodeStateAsUpdate } from "yjs";
import { formatError } from "@/lib/format-error";
import { readyCore } from "@/lib/rust-core";

const MERGE_MS = 200;
const PERSIST_IDLE_MS = 5000;
const COMPACT_THRESHOLD = 200;
/** First wait before rejoining a channel the server closed; doubles per failure. */
const REJOIN_BASE_MS = 1000;
const REJOIN_MAX_MS = 30_000;
/** The length of an update that carries nothing: no items, no deletions. */
const EMPTY_UPDATE_LENGTH = 2;

export interface RealtimeYjsProviderOptions {
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
  /**
   * Write the document body out, and resolve `true` only when it is durable.
   *
   * The body is the other copy of everything compaction is about to delete log
   * rows for: after a compaction, reconstruction is "the body, then the tail".
   * The editor writes that body on a debounce and fire-and-forget, so a
   * compaction could delete rows whose content existed only in memory — the one
   * way this path can lose an edit rather than merely duplicate work.
   *
   * `false` means the write did not land (a rejected save is a real case: the
   * logbook refuses an empty body). Compaction is then *deferred*, not attempted:
   * the rows stay, the watermark does not move, and the next successful save
   * compacts. Absent means the caller has no body to persist — a resource whose
   * text lives only in the CRDT log — and compaction proceeds.
   */
  awaitBodyPersisted?: () => Promise<boolean>;
  crdtUpdateStore?: Pick<ICrdtUpdateStore, "compact">;
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
  /**
   * Whether there is anybody to broadcast to.
   *
   * False on a copy that works with no account: the document lives in a folder
   * on one computer, there is no second editor and no socket to reach, and
   * opening one anyway sent a failing request on every keystroke and put a
   * "live sync unavailable" notice under a document nobody else can open. The
   * CRDT log is still written — solo means no transport, not no history.
   */
  live?: boolean;
}

export class RealtimeYjsProvider {
  private channel: RealtimeChannel | null = null;
  /**
   * True only between SUBSCRIBED and the next error or close. Nothing is sent
   * outside it: the client turns a send on a channel that is not joined into a
   * REST call, which fails offline and dropped the edit.
   */
  private connected = false;
  /** Local edits not yet broadcast. Kept merged into one update while offline. */
  private pending: Uint8Array[] = [];
  private mergeTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private rejoinTimer: ReturnType<typeof setTimeout> | null = null;
  private rejoinAttempts = 0;
  private lastPersistedId = 0;
  private destroyed = false;
  private awarenessHandler:
    | ((payload: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void)
    | null = null;

  constructor(private readonly opts: RealtimeYjsProviderOptions) {
    const live = opts.live !== false;
    if (live) this.join();
    opts.doc.on("update", this.onLocalUpdate);
    if (opts.awareness && live) this.bindAwareness(opts.awareness);
    void this.bootstrapFromStore();
  }

  /** Joins the document's broadcast topic. Only called when there is a socket. */
  private join() {
    const opts = this.opts;
    // The socket, which after a cutover is not the same host as the data API.
    const db = getRealtimeClient(opts.db as SupabaseClient);
    const channel = db.channel(`crdt:${opts.resourceType}:${opts.resourceId}`, {
      config: { broadcast: { self: false }, private: true },
    });
    this.channel = channel;
    const on = <P>(event: string, handle: (payload: P) => void) =>
      channel.on("broadcast", { event }, ({ payload }) => this.receive(() => handle(payload as P)));
    on<{ data?: string }>("yjs", (p) => this.onRemote(p));
    on<{ data?: string }>("awareness", (p) => this.onAwarenessRemote(p));
    on<{ sv?: string; from?: number }>("sync1", (p) => this.onSyncStep1(p));
    on<{ to?: number; data?: string; sv?: string }>("sync2", (p) => this.onSyncStep2(p));
    this.connect(channel);
  }

  /** Token first, then join — see the note in `project-lww-invalidator`. */
  private connect(channel: RealtimeChannel) {
    const db = getRealtimeClient(this.opts.db as SupabaseClient);
    void db.realtime
      .setAuth()
      .then(() => {
        // Torn down while the token was on its way: `destroy()` has already
        // left, and joining now would hold a channel nobody owns.
        if (this.destroyed || channel !== this.channel) return;
        channel.subscribe((status, err) => {
          if (process.env.NODE_ENV !== "production") {
            console.debug(`[collab] ${channel.topic} → ${status}${err ? `: ${err.message}` : ""}`);
          }
          // A channel this provider has since replaced can still report.
          if (this.destroyed || channel !== this.channel) return;
          if (status === "SUBSCRIBED") {
            this.connected = true;
            this.rejoinAttempts = 0;
            this.opts.onConnected?.();
            this.onJoined();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            this.opts.onError?.("subscribe", `${status}${err ? `: ${err.message}` : ""}`);
            this.onDisconnected();
            // The client rejoins an errored or timed-out channel by itself and
            // reports SUBSCRIBED again. A closed one it drops from its registry,
            // so that one is replaced here.
            if (status === "CLOSED") this.scheduleRejoin(() => this.join());
          }
        });
      })
      .catch((err) => {
        this.opts.onError?.("setAuth", formatError(err));
        // Same channel: it never subscribed, and the client hands back the
        // registered channel for a topic, so a new one would double the handlers.
        this.scheduleRejoin(() => this.connect(channel));
      });
  }

  private scheduleRejoin(retry: () => void) {
    if (this.destroyed || this.rejoinTimer) return;
    const wait = Math.min(REJOIN_MAX_MS, REJOIN_BASE_MS * 2 ** this.rejoinAttempts);
    this.rejoinAttempts += 1;
    this.rejoinTimer = setTimeout(() => {
      this.rejoinTimer = null;
      if (!this.destroyed) retry();
    }, wait);
  }

  /**
   * Joined, or joined again. Edits made while away go out first, then the two
   * steps of a Yjs sync: this side's state vector asks each peer for what it
   * lacks (step 1), and each answer carries the peer's own vector so this side
   * can send back what the peer lacks (step 2). The queued edits travel ahead
   * of step 1 on the same ordered channel, so the peer's vector already counts
   * them and they go out once.
   */
  private onJoined() {
    if (this.mergeTimer) clearTimeout(this.mergeTimer);
    void this.flushOutbound();
    const sv = readyCore().encodeBase64(Y.encodeStateVector(this.opts.doc));
    this.broadcast("sync1", { sv, from: this.opts.doc.clientID });
    this.sendOwnAwareness();
  }

  /**
   * Peers seen over a connection that is gone are no longer known to be here.
   * They are forgotten, clock included, rather than marked removed:
   * `removeAwarenessStates` bumps their clock locally, and the state they send
   * again on reconnect (at their unchanged clock) would then be ignored.
   */
  private onDisconnected() {
    this.connected = false;
    const awareness = this.opts.awareness;
    if (!awareness) return;
    const removed = [...awareness.getStates().keys()].filter((id) => id !== this.opts.doc.clientID);
    if (removed.length === 0) return;
    for (const id of removed) {
      awareness.states.delete(id);
      awareness.meta.delete(id);
    }
    const change = { added: [], updated: [], removed };
    awareness.emit("change", [change, this]);
    awareness.emit("update", [change, this]);
  }

  private onSyncStep1(payload: { sv?: string; from?: number }) {
    if (!payload.sv || this.destroyed || payload.from === this.opts.doc.clientID) return;
    const theirs = readyCore().decodeBase64(payload.sv);
    const data = readyCore().encodeBase64(encodeStateAsUpdate(this.opts.doc, theirs));
    const sv = readyCore().encodeBase64(Y.encodeStateVector(this.opts.doc));
    this.broadcast("sync2", { to: payload.from, data, sv });
    // The newcomer has not seen this side's presence yet.
    this.sendOwnAwareness();
  }

  private onSyncStep2(payload: { to?: number; data?: string; sv?: string }) {
    if (payload.to !== this.opts.doc.clientID || this.destroyed) return;
    if (payload.data) Y.applyUpdate(this.opts.doc, readyCore().decodeBase64(payload.data), this);
    if (!payload.sv) return;
    const missing = encodeStateAsUpdate(this.opts.doc, readyCore().decodeBase64(payload.sv));
    if (missing.length <= EMPTY_UPDATE_LENGTH) return;
    this.broadcast("yjs", { data: readyCore().encodeBase64(missing) });
  }

  private broadcast(event: string, payload: Record<string, unknown>) {
    if (!this.connected || !this.channel) return;
    this.channel
      .send({ type: "broadcast", event, payload })
      .then((res) => {
        if (res !== "ok") this.opts.onError?.("send", `${event} returned ${String(res)}`);
      })
      .catch((err) => this.opts.onError?.("send", formatError(err)));
  }

  private sendOwnAwareness() {
    const awareness = this.opts.awareness;
    if (!awareness || awareness.getLocalState() === null) return;
    const update = encodeAwarenessUpdate(awareness, [this.opts.doc.clientID]);
    this.broadcast("awareness", { data: readyCore().encodeBase64(update) });
  }

  private bindAwareness(awareness: Awareness) {
    this.awarenessHandler = ({ added, updated, removed }, origin) => {
      // What came from a peer, or was cleared on a disconnect, is not passed
      // on: every receiver used to re-broadcast every peer's cursor.
      if (origin === this) return;
      const changed = added.concat(updated, removed);
      const update = encodeAwarenessUpdate(awareness, changed);
      this.broadcast("awareness", { data: readyCore().encodeBase64(update) });
    };
    awareness.on("update", this.awarenessHandler);
  }

  private onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    this.pending.push(update);
    if (this.mergeTimer) return;
    this.mergeTimer = setTimeout(() => void this.flushOutbound(), MERGE_MS);
    if (!this.persistTimer) {
      this.persistTimer = setTimeout(() => {
        // Nothing awaits a timer: a failed write (offline) is a notice, not an
        // unhandled rejection. The next persist carries the same state.
        this.persistTail().catch((err) => this.opts.onError?.("persist", formatError(err)));
      }, PERSIST_IDLE_MS);
    }
  };

  private async flushOutbound() {
    this.mergeTimer = null;
    if (this.pending.length === 0 || this.destroyed) return;
    if (!this.channel) {
      // Solo: the updates were queued for a broadcast that is not happening.
      // Persistence runs on its own timer and has its own copy of them.
      this.pending = [];
      return;
    }
    const merged = this.pending.length === 1 ? this.pending[0]! : mergeUpdates(this.pending);
    // Offline they are held, as one update so a long outage costs one copy of
    // the edits rather than one per keystroke. `onJoined` sends them.
    this.pending = [merged];
    if (!this.connected) return;
    this.pending = [];
    const data = readyCore().encodeBase64(merged);
    try {
      const res = await this.channel.send({ type: "broadcast", event: "yjs", payload: { data } });
      if (res !== "ok") {
        this.requeue(merged);
        this.opts.onError?.("send", `broadcast returned ${String(res)}`);
      }
    } catch (err) {
      this.requeue(merged);
      this.opts.onError?.("send", formatError(err));
    }
  }

  /** A failed send goes out again with the next join; Yjs ignores a repeat. */
  private requeue(update: Uint8Array) {
    if (!this.destroyed) this.pending.unshift(update);
  }

  /** A peer's message is untrusted input: a malformed one is reported, never thrown. */
  private receive(apply: () => void) {
    try {
      apply();
    } catch (err) {
      this.opts.onError?.("receive", formatError(err));
    }
  }

  private onRemote(payload: { data?: string }) {
    if (!payload.data || this.destroyed) return;
    const bin = readyCore().decodeBase64(payload.data);
    Y.applyUpdate(this.opts.doc, bin, this);
  }

  private onAwarenessRemote(payload: { data?: string }) {
    if (!payload.data || this.destroyed || !this.opts.awareness) return;
    const bin = readyCore().decodeBase64(payload.data);
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
      this.opts.onError?.("bootstrap", formatError(err));
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
    if (!this.opts.crdtUpdateStore) return;
    const snapshotUpto = (await this.opts.getSnapshotUpto?.()) ?? 0;
    const tailCount = await this.opts.crdtStore.countAfter(
      this.opts.resourceType,
      this.opts.resourceId,
      snapshotUpto,
    );
    if (tailCount < COMPACT_THRESHOLD || this.lastPersistedId <= snapshotUpto) return;

    // The body is the other copy of everything this is about to delete log rows
    // for: after compaction, reconstruction is "the body, then the tail". A save
    // that did not land defers this rather than risking the edit — see
    // `awaitBodyPersisted`.
    if (this.opts.awaitBodyPersisted && !(await this.opts.awaitBodyPersisted())) {
      this.opts.onError?.("compact", "the body was not durable, so compaction was deferred");
      return;
    }

    const outcome = await this.opts.crdtUpdateStore.compact({
      resourceType: this.opts.resourceType,
      resourceId: this.opts.resourceId,
      uptoId: this.lastPersistedId,
      // Already read above, to size the tail: a caller whose snapshot is behind
      // the stored watermark is a local no-op (the Rust compact arm checks it).
      currentUpto: snapshotUpto,
    });

    if (outcome.status === "not-permitted") {
      // This reader can see the document but not compact it, so the log keeps
      // growing while they have it open. Worth saying once, and not an error for
      // them to act on — hence a notice rather than a throw.
      this.opts.onError?.("compact", "this account may not compact this document");
    }
  }

  async destroy() {
    this.destroyed = true;
    this.opts.doc.off("update", this.onLocalUpdate);
    if (this.mergeTimer) clearTimeout(this.mergeTimer);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    if (this.rejoinTimer) clearTimeout(this.rejoinTimer);
    this.rejoinTimer = null;
    if (this.opts.awareness && this.awarenessHandler) {
      this.opts.awareness.off("update", this.awarenessHandler);
      try {
        removeAwarenessStates(this.opts.awareness, [this.opts.doc.clientID], this);
        // Said before leaving, or peers keep this avatar for their 30 s
        // presence timeout.
        const gone = encodeAwarenessUpdate(this.opts.awareness, [this.opts.doc.clientID]);
        this.broadcast("awareness", { data: readyCore().encodeBase64(gone) });
      } catch (err) {
        this.opts.onError?.("awareness", formatError(err));
      }
    }
    this.connected = false;

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
    //
    // Nothing awaits `destroy()` — React's cleanup fires it and moves on — so
    // a rejection here is an unhandled one. Offline, both the leave and the
    // closing persist reject (the socket is closed, the fetch fails), and each
    // logged "Uncaught (in promise)" on every exit from Edit mode. They are
    // reported through `onError` instead: the row body has its own save, so
    // the failure is worth a notice, not a crash.
    this.channel?.unsubscribe().catch((err) => this.opts.onError?.("leave", formatError(err)));

    // Forced: `destroyed` is already true above, and this is the flush that
    // carries the last few seconds of typing into the log.
    try {
      await this.persistTail(true);
      await this.maybeCompact();
    } catch (err) {
      this.opts.onError?.("persist", formatError(err));
    }
  }
}
