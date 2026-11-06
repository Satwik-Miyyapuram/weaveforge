/**
 * ShareJS "text" ops, the format Overleaf's editor speaks. An op is a list of
 * components applied in order; positions count UTF-16 code units, as JavaScript
 * strings and CodeMirror do. Comments (`c`) change no text and are passed through.
 * Ports ShareJS's text type (apply, transform, transformX); no other behaviour.
 */

export type TextComponent = { p: number; i: string } | { p: number; d: string } | { p: number; c: string; t?: string };
export type TextOp = TextComponent[];

const isInsert = (c: TextComponent): c is { p: number; i: string } => "i" in c;
const isDelete = (c: TextComponent): c is { p: number; d: string } => "d" in c;

/** `text` with `op` applied. Throws when a delete does not match the text it removes. */
export function applyOp(text: string, op: TextOp): string {
  let out = text;
  for (const c of op) {
    if (isInsert(c)) {
      if (c.p > out.length) throw new Error("Insert past the end of the document.");
      out = out.slice(0, c.p) + c.i + out.slice(c.p);
    } else if (isDelete(c)) {
      if (out.slice(c.p, c.p + c.d.length) !== c.d) throw new Error("Delete does not match the document.");
      out = out.slice(0, c.p) + out.slice(c.p + c.d.length);
    }
  }
  return out;
}

function append(dest: TextOp, c: TextComponent): void {
  if (isInsert(c) && c.i === "") return;
  if (isDelete(c) && c.d === "") return;
  dest.push(c);
}

/** Where `pos` moves to after `c`; `insertAfter` puts it after an insert at the same spot. */
function transformPosition(pos: number, c: TextComponent, insertAfter = false): number {
  if (isInsert(c)) return c.p < pos || (c.p === pos && insertAfter) ? pos + c.i.length : pos;
  if (isDelete(c)) {
    if (pos <= c.p) return pos;
    if (pos <= c.p + c.d.length) return c.p;
    return pos - c.d.length;
  }
  return pos;
}

/** `c` rewritten to apply after `other`; `side` breaks ties between inserts at one spot. */
function transformComponent(dest: TextOp, c: TextComponent, other: TextComponent, side: "left" | "right"): TextOp {
  if (isInsert(c)) {
    append(dest, { i: c.i, p: transformPosition(c.p, other, side === "right") });
  } else if (isDelete(c)) {
    if (isInsert(other)) {
      let s = c.d;
      if (c.p < other.p) {
        append(dest, { d: s.slice(0, other.p - c.p), p: c.p });
        s = s.slice(other.p - c.p);
      }
      append(dest, { d: s, p: c.p + other.i.length });
    } else if (isDelete(other)) {
      if (c.p >= other.p + other.d.length) append(dest, { d: c.d, p: c.p - other.d.length });
      else if (c.p + c.d.length <= other.p) append(dest, c);
      else {
        let d = "";
        if (c.p < other.p) d = c.d.slice(0, other.p - c.p);
        if (c.p + c.d.length > other.p + other.d.length) d += c.d.slice(other.p + other.d.length - c.p);
        const start = Math.max(c.p, other.p);
        const end = Math.min(c.p + c.d.length, other.p + other.d.length);
        if (c.d.slice(start - c.p, end - c.p) !== other.d.slice(start - other.p, end - other.p)) {
          throw new Error("Overlapping deletes do not match.");
        }
        append(dest, { d, p: transformPosition(c.p, other) });
      }
    } else {
      dest.push(c);
    }
  } else {
    dest.push({ ...c, p: transformPosition(c.p, other) });
  }
  return dest;
}

/**
 * Both ops rewritten so each applies after the other: `left` is ours, `right`
 * the one the server applied first. At one spot ours goes first, as on the server.
 */
export function transformX(left: TextOp, right: TextOp): [TextOp, TextOp] {
  let leftOp = left;
  const newRight: TextOp = [];
  for (const rc of right) {
    let rightComponent: TextComponent | null = rc;
    const newLeft: TextOp = [];
    let k = 0;
    while (k < leftOp.length && rightComponent) {
      const next: TextOp = [];
      const leftComponent = leftOp[k] as TextComponent;
      transformComponent(newLeft, leftComponent, rightComponent, "left");
      transformComponent(next, rightComponent, leftComponent, "right");
      k += 1;
      if (next.length === 1) {
        rightComponent = next[0] as TextComponent;
      } else if (next.length === 0) {
        for (const l of leftOp.slice(k)) append(newLeft, l);
        rightComponent = null;
      } else {
        const [l2, r2] = transformX(leftOp.slice(k), next);
        for (const l of l2) append(newLeft, l);
        for (const r of r2) append(newRight, r);
        rightComponent = null;
        k = leftOp.length;
      }
    }
    if (rightComponent) append(newRight, rightComponent);
    leftOp = newLeft;
  }
  return [leftOp, newRight];
}
