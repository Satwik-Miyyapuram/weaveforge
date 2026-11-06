import { StateEffect, type Range } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { loadedMathRenderer, loadMathRenderer } from "@/components/markdown/math-renderer";
import { latexVisualSpans } from "../lib/latex-visual";

/** Sent once KaTeX has loaded, so math drawn as source is drawn again. */
const mathReady = StateEffect.define<null>();

class BulletWidget extends WidgetType {
  override eq() { return true; }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-vis-bullet";
    el.textContent = "•";
    return el;
  }
}

class MathWidget extends WidgetType {
  constructor(readonly tex: string) { super(); }
  override eq(other: MathWidget) { return other.tex === this.tex; }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-vis-math";
    const katex = loadedMathRenderer();
    if (katex) el.innerHTML = katex.renderToString(this.tex, { displayMode: false, throwOnError: false, trust: false, macros: {} });
    else el.textContent = this.tex;
    return el;
  }
}

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const bold = Decoration.mark({ class: "cm-vis-bold" });
const italic = Decoration.mark({ class: "cm-vis-italic" });

function build(view: EditorView): DecorationSet {
  const { doc, selection } = view.state;
  const out: Range<Decoration>[] = [];
  let math = false;
  let done = 0;
  for (const visible of view.visibleRanges) {
    const from = Math.max(doc.lineAt(visible.from).from, done);
    const to = doc.lineAt(visible.to).to;
    if (from > to) continue;
    done = to + 1;
    const cursors = selection.ranges.map((r) => ({ from: r.from - from, to: r.to - from }));
    for (const s of latexVisualSpans(doc.sliceString(from, to), cursors)) {
      const a = from + s.from, b = from + s.to;
      if (s.kind === "item") out.push(bullet.range(a, b));
      else if (s.kind === "math") {
        math = true;
        out.push(Decoration.replace({ widget: new MathWidget(s.tex) }).range(a, b));
      } else {
        if (s.kind === "heading") out.push(Decoration.line({ class: `cm-vis-h${s.level}` }).range(doc.lineAt(a).from));
        else out.push((s.kind === "bold" ? bold : italic).range(a, b));
        for (const [x, y] of s.hide) out.push(hidden.range(from + x, from + y));
      }
    }
  }
  if (math && !loadedMathRenderer()) void loadMathRenderer().then(() => view.dispatch({ effects: mathReady.of(null) }), () => {});
  return Decoration.set(out, true);
}

/**
 * Overleaf's Visual Editor over the LaTeX source: headings, bold, italic,
 * list bullets and inline math drawn as they print, with the markup shown again
 * wherever the cursor is. The text stays the source; only its drawing changes.
 */
export const latexVisualMode = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.transactions.some((t) => t.effects.some((e) => e.is(mathReady)))) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
