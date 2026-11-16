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
/** How long a joined client listens for peers before it may reconcile alone. */
const HELLO_WINDOW_MS = 600;
/** Reconcile anyway after this long: a peer it is waiting on may have left. */
const SEED_FALLBACK_MS = 4000;
/**
 * A join (token, then subscribe) not done by now has failed: work alone, retry.
 * An errored channel gets as long for the client's own rejoin before it is replaced.
 */
const JOIN_TIMEOUT_MS = 10_000;
/** Rejoin delays double from the first to the cap, then stay there, forever. */
const REJOIN_BASE_MS = 1000;
const REJOIN_MAX_MS = 30_000;

/**
 * The sync handshake, on its own broadcast event. `hello` asks every peer for
 * the state the sender lacks; `state` answers it (and is answered once, with
 * `ack`, so both sides end up with the union). `seeded` says whether the sender
 * has reconciled the document with the row's body.
 */
type SyncMessage =
  | { type: "hello"; id: number; seeded: boolean; sv: string }
  | { type: "bye"; id: number }
  | { type: "state"; id: number; seeded: boolean; sv: string; data: string; ack?: boolean };

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
  /** Overrides the join timeout and rejoin backoff; tests shorten them. */
  timing?: { joinTimeoutMs?: number; rejoinBaseMs?: number; rejoinMaxMs?: number };
}

export class RealtimeYjsProvider {
  /** Whether there is a socket at all; `channel` is the current join attempt's. */
  private readonly live: boolean;
  private channel: RealtimeChannel | null = null;
  /** The channel last given up on: a client that hands it back is caught. */
  private retired: RealtimeChannel | null = null;
  /** Bumped on every join and every loss: callbacks of an older channel are ignored. */
  private attempt = 0;
  private rejoins = 0;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  private rejoinTimer: ReturnType<typeof setTimeout> | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Local edits not yet broadcast; held, merged into one, while not joined. */
  private pending: Uint8Array[] = [];
  private mergeTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPersistedId = 0;
  private destroyed = false;
  // Seeding waits for the peers: see `maybeSeed`.
  private booted = false;
  /**
   * Joined: from SUBSCRIBED to the next error, close or loss. Nothing is sent
   * outside it: the client turns a send on a channel that is not joined into a
   * REST call, which fails offline and dropped the edit.
   */
  private subscribed = false;
  private seeded = false;
  private windowOpen = true;
  private syncedWithSeeded = false;
  private readonly peers = new Map<number, boolean>();
  private windowTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private awarenessHandler:
    | ((payload: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void)
    | null = null;

  constructor(private readonly opts: RealtimeYjsProviderOptions) {
    this.live = opts.live !== false;
    if (this.live) this.join();
    opts.doc.on("update", this.onLocalUpdate);
    if (opts.awareness && this.live) this.bindAwareness(opts.awareness);
    void this.bootstrapFromStore();
  }

  /**
   * Joins the document's broadcast topic on a fresh channel. Only called when
   * there is a socket. A join that fails or stalls, or a channel lost after
   * joining, goes to `lost`, which retries: live sync always comes back.
   */
  private join() {
    // The client, the channel or the token threw before any callback could:
    // a failed join like any other, never a dead provider or constructor.
    this.joinOnce().catch((err) => this.lost("join", formatError(err)));
  }

  private async joinOnce() {
    const attempt = ++this.attempt;
    const current = () => !this.destroyed && attempt === this.attempt;
    const opts = this.opts;
    const limit = opts.timing?.joinTimeoutMs ?? JOIN_TIMEOUT_MS;
    this.clearJoinTimer();
    this.armJoinTimer(current, `not joined after ${limit} ms`);
    // The socket, which after a cutover is not the same host as the data API.
    const db = getRealtimeClient(opts.db as SupabaseClient);
    const make = () =>
      db.channel(`crdt:${opts.resourceType}:${opts.resourceId}`, {
        config: { broadcast: { self: false }, private: true },
      });
    let channel = make();
    // The client still holds the channel given up on: subscribing it again
    // throws, and its handlers are bound to the old session. Remove it, then
    // ask for a fresh one; still there, remove it again and retry on the backoff.
    if (channel === this.retired) {
      await this.remove(channel);
      if (!current()) return;
      channel = make();
      if (channel === this.retired) {
        void this.remove(channel);
        this.lost("subscribe", "old channel still registered; removed, retrying");
        return;
      }
    }
    this.channel = channel;
    const on = <P>(event: string, handle: (payload: P) => void) =>
      channel.on("broadcast", { event }, ({ payload }) => {
        // An old channel the client still delivers to is not this session.
        if (channel !== this.channel) return;
        this.receive(() => handle(payload as P));
      });
    on<{ data?: string }>("yjs", (p) => this.onRemote(p));
    on<{ data?: string }>("awareness", (p) => this.onAwarenessRemote(p));
    on<SyncMessage>("sync", (p) => this.onSync(p));
    // Token first, then join — see the note in `project-lww-invalidator`.
    void db.realtime
      .setAuth()
      .then(() => {
        // Torn down, or given up on, while the token was on its way: joining
        // now would hold a channel nobody owns.
        if (!current()) return;
        channel.subscribe((status, err) => {
          if (process.env.NODE_ENV !== "production") {
            console.debug(`[collab] ${channel.topic} → ${status}${err ? `: ${err.message}` : ""}`);
          }
          if (!current()) return;
          const detail = `${status}${err ? `: ${err.message}` : ""}`;
          if (status === "SUBSCRIBED") {
            this.clearJoinTimer();
            this.rejoins = 0;
            // A throw here would escape into realtime-js and leave the channel
            // joined but never used, with nothing to start a rejoin.
            try {
              this.opts.onConnected?.();
              this.onJoined();
            } catch (err) {
              if (current()) this.lost("subscribe", formatError(err));
            }
          } else if (status === "CLOSED") {
            this.lost("subscribe", detail, true);
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            // The client rejoins an errored channel by itself, but not always (a
            // refused token or topic can end there): it gets one join timeout to
            // report SUBSCRIBED again before `lost` replaces it.
            this.opts.onError?.("subscribe", detail);
            this.down();
            this.armJoinTimer(current, `${status}, not back after ${limit} ms`);
          }
        });
      })
      .catch((err) => {
        if (current()) this.lost("setAuth", formatError(err));
      });
  }

  /** Gives the current join `limit` ms, unless it already has a deadline. */
  private armJoinTimer(current: () => boolean, detail: string) {
    if (this.joinTimer) return;
    this.joinTimer = setTimeout(() => {
      this.joinTimer = null;
      if (current()) this.lost("subscribe", detail);
    }, this.opts.timing?.joinTimeoutMs ?? JOIN_TIMEOUT_MS);
  }

  private clearJoinTimer() {
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.joinTimer = null;
  }

  /**
   * Nobody can be reached, so there is nobody to wait for: seed now if not yet
   * seeded, so the editor works alone. Seeding alone is safe even when a peer
   * seeds alone too: the seed is made deterministically from (log state, body)
   * (`reconcileWithBody`), so two seeds of the same state merge as one copy.
   *
   * Peers seen over the connection are forgotten, clock included, rather than
   * marked removed: `removeAwarenessStates` bumps their clock locally, and the
   * state they send again on reconnect (at their unchanged clock) would then be
   * ignored.
   */
  private down() {
    this.subscribed = false;
    this.windowOpen = false;
    this.maybeSeed();
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

  /**
   * The join failed or stalled, or the joined channel was lost: work alone,
   * then leave this channel and join a fresh one after a backoff, for as long
   * as the provider lives. The next join runs the usual hello/state exchange,
   * which merges both sides; it never seeds again. `closed`: the client has
   * already dropped the channel, so there is nothing to remove.
   */
  private lost(stage: string, detail: string, closed = false) {
    this.opts.onError?.(stage, detail);
    this.attempt += 1;
    this.clearJoinTimer();
    this.down();
    // Removed, not only left: supabase-js keys channels by topic and hands back
    // the registered one, so a channel merely left could come back as the "fresh"
    // one. The join still waits for the removal, bounded by one join timeout or
    // the channel's own leave timeout if longer, because realtime-js deregisters
    // only once the leave settles; one that outlasts it is caught in `joinOnce`.
    const old = this.channel;
    this.channel = null;
    if (old) this.retired = old;
    const left = old && !closed ? this.remove(old) : Promise.resolve();
    const t = this.opts.timing;
    const delay = Math.min(t?.rejoinMaxMs ?? REJOIN_MAX_MS, (t?.rejoinBaseMs ?? REJOIN_BASE_MS) * 2 ** this.rejoins);
    this.rejoins += 1;
    const leaveWait = Math.max(t?.joinTimeoutMs ?? JOIN_TIMEOUT_MS, old?.timeout ?? 0);
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
    const leaveLimit = new Promise<void>((resolve) => {
      this.leaveTimer = setTimeout(resolve, leaveWait);
    });
    if (this.rejoinTimer) clearTimeout(this.rejoinTimer);
    this.rejoinTimer = setTimeout(() => {
      this.rejoinTimer = null;
      void Promise.race([left, leaveLimit]).then(() => {
        if (this.leaveTimer) clearTimeout(this.leaveTimer);
        this.leaveTimer = null;
        if (!this.destroyed) this.join();
      });
    }, delay);
  }

  /**
   * Unsubscribes the channel and drops it from the client's registry. Only for
   * replacing a channel: the editor joins the topic again, so the shared socket
   * may disconnect for a moment until the next subscribe reconnects it.
   */
  private async remove(channel: RealtimeChannel) {
    const db = getRealtimeClient(this.opts.db as SupabaseClient);
    try {
      await db.removeChannel(channel);
    } catch (err) {
      this.opts.onError?.("leave", formatError(err));
    }
  }

  private bindAwareness(awareness: Awareness) {
    this.awarenessHandler = ({ added, updated, removed }, origin) => {
      // What came from a peer, or was cleared on a disconnect, is not passed
      // on: every receiver used to re-broadcast every peer's cursor.
      if (origin === this) return;
      // Only this client's own state is ours to announce. Awareness's sweep
      // also drops peers that went quiet, and telling everyone that would mark
      // a peer gone for clients that can still hear it.
      const own = this.opts.doc.clientID;
      if (!added.concat(updated, removed).includes(own)) return;
      const update = encodeAwarenessUpdate(awareness, [own]);
      this.broadcast("awareness", { data: readyCore().encodeBase64(update) });
    };
    awareness.on("update", this.awarenessHandler);
  }

  /** Presence for a peer that has not seen it: set while away, or a newcomer. */
  private sendOwnAwareness() {
    const awareness = this.opts.awareness;
    if (!awareness || awareness.getLocalState() === null) return;
    const update = encodeAwarenessUpdate(awareness, [this.opts.doc.clientID]);
    this.broadcast("awareness", { data: readyCore().encodeBase64(update) });
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
    if (!this.live) {
      // Solo: the updates were queued for a broadcast that is not happening.
      // Persistence runs on its own timer and has its own copy of them.
      this.pending = [];
      return;
    }
    const merged = this.pending.length === 1 ? this.pending[0]! : mergeUpdates(this.pending);
    // Offline they are held, as one update so a long outage costs one copy of
    // the edits rather than one per keystroke. `onJoined` sends them.
    this.pending = [merged];
    if (!this.subscribed || !this.channel) return;
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

  /**
   * Every join, the first and each reconnect: ask the peers for what this
   * client lacks. A reconnect gets back the updates it missed while away.
   * Edits made while away go out first, on the same ordered channel, so the
   * peers' answers already count them.
   */
  private onJoined() {
    this.subscribed = true;
    if (this.mergeTimer) clearTimeout(this.mergeTimer);
    void this.flushOutbound();
    this.broadcast("sync", { type: "hello", id: this.opts.doc.clientID, seeded: this.seeded, sv: this.stateVector() });
    // Presence set while away was never sent: show it to the peers now.
    this.sendOwnAwareness();
    this.openWindow();
  }

  private onSync(msg: SyncMessage) {
    if (this.destroyed || typeof msg?.id !== "number" || msg.id === this.opts.doc.clientID) return;
    if (msg.type === "bye") {
      // A peer that left will never seed: stop waiting for it.
      this.peers.delete(msg.id);
      this.maybeSeed();
      return;
    }
    this.peers.set(msg.id, msg.seeded === true || this.peers.get(msg.id) === true);
    if (msg.type === "state") {
      if (msg.data) Y.applyUpdate(this.opts.doc, readyCore().decodeBase64(msg.data), this);
      // Their state is now part of this document: a seeded peer's carries the
      // reconcile, so this client's own would only repeat it.
      if (msg.seeded) this.syncedWithSeeded = true;
      if (!msg.ack) this.sendState(msg.sv, true);
    } else if (msg.type === "hello") {
      this.sendState(msg.sv, false);
      // The newcomer has not seen this client's presence yet.
      this.sendOwnAwareness();
    }
    this.maybeSeed();
  }

  /** This client's state, less what the state vector `sv` says the peer holds. */
  private sendState(sv: string, ack: boolean) {
    const core = readyCore();
    const update = encodeStateAsUpdate(this.opts.doc, sv ? core.decodeBase64(sv) : undefined);
    this.broadcast("sync", {
      type: "state",
      id: this.opts.doc.clientID,
      seeded: this.seeded,
      sv: this.stateVector(),
      data: core.encodeBase64(update),
      ...(ack ? { ack } : {}),
    });
  }

  private stateVector(): string {
    return readyCore().encodeBase64(Y.encodeStateVector(this.opts.doc));
  }

  private broadcast(event: string, payload: SyncMessage | { data: string }) {
    if (!this.channel || !this.subscribed) return;
    this.channel
      .send({ type: "broadcast", event, payload })
      .then((res) => {
        if (res !== "ok") this.opts.onError?.("send", `${event} returned ${String(res)}`);
      })
      .catch((err) => this.opts.onError?.("send", formatError(err)));
  }

  /**
   * Listen for peers for a moment once the log is replayed and the channel
   * joined. The fallback starts here too, not at replay: a join slower than
   * the fallback would otherwise seed before any peer was heard.
   */
  private openWindow() {
    if (!this.booted || !this.subscribed || this.windowTimer || this.seeded) return;
    this.fallbackTimer ??= setTimeout(() => this.maybeSeed(true), SEED_FALLBACK_MS);
    this.windowTimer = setTimeout(() => {
      this.windowOpen = false;
      this.maybeSeed();
    }, HELLO_WINDOW_MS);
  }

  /**
   * Reconcile the document with the row's body, once, and only when no other
   * client is about to.
   *
   * Two clients that each rebuild one body from different reads of the log
   * make different operations, and the merge holds the new text twice. So a
   * client reconciles alone only when it has nobody to wait for: no channel, a
   * seeded peer's state already merged in (its reconcile is then a no-op), or
   * the listening window closed with no lower client id still unseeded. The
   * others wait for that client's state. A peer that leaves unseeded says
   * "bye"; the fallback covers one that drops without a word.
   */
  private maybeSeed(force = false) {
    if (this.seeded || this.destroyed || !this.booted) return;
    if (!force && this.live && !this.syncedWithSeeded) {
      if (this.windowOpen) return;
      const me = this.opts.doc.clientID;
      for (const [id, seeded] of this.peers) if (!seeded && id < me) return;
    }
    this.seeded = true;
    if (this.windowTimer) clearTimeout(this.windowTimer);
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.opts.seed?.();
    // Announce at once, not after the merge delay: the waiting peers seed on it.
    this.sendState("", true);
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
      // the first keystroke would persist that deletion. With peers on the
      // channel it waits for them first: see `maybeSeed`.
      this.booted = true;
      if (!this.destroyed) {
        this.openWindow();
        this.maybeSeed();
      }
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
    if (this.windowTimer) clearTimeout(this.windowTimer);
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    if (this.joinTimer) clearTimeout(this.joinTimer);
    if (this.rejoinTimer) clearTimeout(this.rejoinTimer);
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
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
    // Unseeded, say so first: a peer waiting on this client's lower id would
    // otherwise wait out the whole fallback. `broadcast` still runs: only
    // `onSync` checks `destroyed`.
    if (!this.seeded) this.broadcast("sync", { type: "bye", id: this.opts.doc.clientID });
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
