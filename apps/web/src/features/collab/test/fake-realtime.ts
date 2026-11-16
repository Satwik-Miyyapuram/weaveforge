/**
 * An in-memory stand-in for the Realtime broadcast server, so two or more
 * `RealtimeYjsProvider`s can talk to each other with no network.
 *
 * It mimics what the provider depends on in supabase-js: `db.channel(topic)`,
 * `db.realtime.setAuth()`, and a channel with `on`, `subscribe(cb)`, `send`
 * and `unsubscribe`. Messages are JSON round-tripped (the socket speaks JSON)
 * and delivered on a microtask, in order, to every *other* joined channel on
 * the topic (`broadcast.self: false`).
 *
 * The test drives the connection: `drop()` is a socket loss (the library
 * reports CHANNEL_ERROR and rejoins by itself later, which `restore()` plays),
 * `serverClose()` is the server ending the channel (CLOSED, no library rejoin).
 * A refused join reports `refuseJoinStatus`: CLOSED, or CHANNEL_ERROR with no
 * library rejoin after it (an expired token or a denied topic).
 */

export type Status = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";
type Handler = (msg: { payload: unknown }) => void;

export interface Sent {
  from: FakeChannel;
  event: string;
  payload: unknown;
}

export class FakeChannel {
  joined = false;
  /** The next this many sends on this channel fail even though it is joined. */
  failSends = 0;
  private readonly handlers = new Map<string, Handler[]>();
  private statusCb: ((status: Status, err?: Error) => void) | null = null;

  constructor(
    readonly topic: string,
    private readonly server: FakeRealtime,
  ) {}

  on(_type: string, filter: { event: string }, cb: Handler) {
    const list = this.handlers.get(filter.event) ?? [];
    list.push(cb);
    this.handlers.set(filter.event, list);
    return this;
  }

  subscribe(cb?: (status: Status, err?: Error) => void) {
    this.statusCb = cb ?? null;
    this.server.subscribes += 1;
    if (this.server.refuseJoins) {
      const status = this.server.refuseJoinStatus;
      queueMicrotask(() => this.statusCb?.(status));
      return this;
    }
    this.join();
    return this;
  }

  async send(msg: { type: string; event: string; payload: unknown }) {
    this.server.sent.push({ from: this, event: msg.event, payload: msg.payload });
    // A channel that is not joined has nowhere to push to (the real client
    // falls back to a REST call, which fails offline).
    if (!this.joined) return "error";
    if (this.failSends > 0) {
      this.failSends -= 1;
      return "error";
    }
    const wire = JSON.stringify(msg.payload);
    for (const peer of this.server.peersOf(this)) {
      queueMicrotask(() => peer.deliver(msg.event, JSON.parse(wire)));
    }
    return "ok";
  }

  async unsubscribe() {
    this.server.unsubscribes += 1;
    this.leave("CLOSED");
    return "ok";
  }

  /** Socket loss: the library reports an error and will rejoin by itself. */
  drop() {
    this.joined = false;
    this.statusCb?.("CHANNEL_ERROR", new Error("socket closed"));
  }

  /** The library's own rejoin after `drop()`. */
  restore() {
    this.join();
  }

  /** The server ends the channel. The library does not rejoin a closed one. */
  serverClose() {
    this.leave("CLOSED");
  }

  /** A status the library reports late, after the provider moved on. */
  lateStatus(status: Status) {
    this.statusCb?.(status);
  }

  handlerCount() {
    let n = 0;
    for (const list of this.handlers.values()) n += list.length;
    return n;
  }

  private join() {
    this.joined = true;
    this.server.attach(this);
    queueMicrotask(() => {
      if (this.joined) this.statusCb?.("SUBSCRIBED");
    });
  }

  private leave(status: Status) {
    const wasJoined = this.joined;
    this.joined = false;
    this.server.detach(this);
    if (wasJoined) this.statusCb?.(status);
  }

  private deliver(event: string, payload: unknown) {
    if (!this.joined) return;
    for (const cb of this.handlers.get(event) ?? []) cb({ payload });
  }
}

export class FakeRealtime {
  readonly sent: Sent[] = [];
  subscribes = 0;
  unsubscribes = 0;
  /** Every join answers CLOSED (a server that keeps refusing). */
  refuseJoins = false;
  /** What a refused join reports. */
  refuseJoinStatus: Status = "CLOSED";
  /** setAuth rejects while this is set. */
  failAuth = false;
  private readonly members = new Map<string, Set<FakeChannel>>();

  /** One client's `db`: each call to `channel()` is a fresh channel object. */
  client() {
    const channels: FakeChannel[] = [];
    const db = {
      channel: (topic: string) => {
        const ch = new FakeChannel(topic, this);
        channels.push(ch);
        return ch;
      },
      realtime: {
        setAuth: async () => {
          if (this.failAuth) throw new Error("token refused");
        },
      },
    };
    return { db, channels, current: () => channels[channels.length - 1]! };
  }

  attach(ch: FakeChannel) {
    const set = this.members.get(ch.topic) ?? new Set();
    set.add(ch);
    this.members.set(ch.topic, set);
  }

  detach(ch: FakeChannel) {
    this.members.get(ch.topic)?.delete(ch);
  }

  peersOf(ch: FakeChannel) {
    return [...(this.members.get(ch.topic) ?? [])].filter((p) => p !== ch && p.joined);
  }
}

/** A `crdt_updates` table in memory, shared by every client of a test. */
export function memoryCrdtStore() {
  const rows: { id: number; payload: Uint8Array }[] = [];
  return {
    rows,
    listAfter: async (_type: string, _id: string, after: number) => rows.filter((r) => r.id > after),
    append: async (input: { payload: Uint8Array }) => {
      const row = { id: rows.length + 1, payload: input.payload };
      rows.push(row);
      return { id: row.id };
    },
    countAfter: async (_type: string, _id: string, after: number) => rows.filter((r) => r.id > after).length,
  };
}
