import { applyOp, transformX, type TextOp } from "../domain/text-ot";

/**
 * One Overleaf doc being edited live, as ShareJS clients keep it: at most one
 * op in flight to the server, later local edits waiting in `pending`, and remote
 * ops transformed past both before they reach the editor. No network here.
 */
export class LiveDoc {
  private inflight: TextOp | null = null;
  private pending: TextOp = [];

  constructor(
    private textNow: string,
    private versionNow: number,
  ) {}

  get text(): string {
    return this.textNow;
  }

  get version(): number {
    return this.versionNow;
  }

  /** True while an edit has not been confirmed by the server. */
  get unsaved(): boolean {
    return this.inflight !== null || this.pending.length > 0;
  }

  /** A local edit, already shown in the editor. */
  local(op: TextOp): void {
    if (op.length === 0) return;
    this.textNow = applyOp(this.textNow, op);
    this.pending = [...this.pending, ...op];
  }

  /** The op to send now with the version it applies at, or null while one is in flight. */
  take(): { op: TextOp; version: number } | null {
    if (this.inflight || this.pending.length === 0) return null;
    this.inflight = this.pending;
    this.pending = [];
    return { op: this.inflight, version: this.versionNow };
  }

  /** The server applied our in-flight op. */
  acked(): void {
    if (!this.inflight) return;
    this.inflight = null;
    this.versionNow += 1;
  }

  /**
   * Someone else's op at version `version`. Returns the op rewritten for the
   * text the editor shows: empty when the op is older than this copy (it is
   * already in the loaded text), or null when an op was missed and the doc must
   * be loaded again.
   */
  remote(op: TextOp, version: number): TextOp | null {
    if (version < this.versionNow) return [];
    if (version > this.versionNow) return null;
    let theirs = op;
    if (this.inflight) [this.inflight, theirs] = transformX(this.inflight, theirs);
    if (this.pending.length > 0) [this.pending, theirs] = transformX(this.pending, theirs);
    this.textNow = applyOp(this.textNow, theirs);
    this.versionNow += 1;
    return theirs;
  }
}

/** Overleaf's `otUpdateApplied` payload, as far as the editor needs it. */
export type OtUpdate = { doc: string; v: number; op?: TextOp };

/** The `otUpdateApplied` update in a live event, or null for any other event. */
export function otUpdateOf(event: { name: string; args?: unknown[] }): OtUpdate | null {
  if (event.name !== "otUpdateApplied") return null;
  const update = event.args?.[0] as Partial<OtUpdate> | undefined;
  if (!update || typeof update.doc !== "string" || typeof update.v !== "number") return null;
  return Array.isArray(update.op) ? { doc: update.doc, v: update.v, op: update.op } : { doc: update.doc, v: update.v };
}
