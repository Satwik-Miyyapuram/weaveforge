import type { ReactNode } from "react";
import { ToolButton } from "@/components/controls";
import { Menu } from "@/components/menu";
import { Popover } from "@/components/popover";
import { Select } from "@/components/select";
import type { LatexFormat, TextStyle } from "../lib/latex-format";

/** A 16px stroke glyph for a toolbar button. */
const Glyph = ({ children }: { children: ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const STYLES: { value: TextStyle; label: string }[] = [
  { value: "normal", label: "Normal text" },
  { value: "section", label: "Section" },
  { value: "subsection", label: "Subsection" },
  { value: "subsubsection", label: "Subsubsection" },
  { value: "paragraph", label: "Paragraph" },
];

type Tool = { format: LatexFormat; label: string; icon: ReactNode };
const sep = "sep" as const;

/** Always on the bar. */
const CORE: Tool[] = [
  { format: "bold", label: "Bold", icon: <b>B</b> },
  { format: "italic", label: "Italic", icon: <i>I</i> },
];

/** On the bar when it is wide; in the More formatting menu when it is narrow. */
const EXTRA: (Tool | typeof sep)[] = [
  { format: "math", label: "Math", icon: <span>π</span> },
  { format: "displayMath", label: "Display math", icon: <span>Σ</span> },
  sep,
  { format: "link", label: "Link", icon: <Glyph><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></Glyph> },
  { format: "itemize", label: "Bullet list", icon: <Glyph><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></Glyph> },
  { format: "enumerate", label: "Numbered list", icon: <Glyph><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 4v4M3 18h3l-3 3h3" /></Glyph> },
  { format: "comment", label: "Toggle comment", icon: <Glyph><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Glyph> },
];

/**
 * Overleaf's editor toolbar, over the source: undo and redo, the text style
 * menu, formatting and search. Each button only reports what was asked; the
 * editor applies it.
 */
export function OverleafEditorToolbar({
  style,
  disabled,
  onFormat,
  onUndo,
  onRedo,
  onSearch,
}: {
  /** The cursor line's heading style, or "other" for a part or chapter. */
  style: TextStyle | "other";
  /** True for a read-only file: only search stays on. */
  disabled: boolean;
  onFormat: (format: LatexFormat) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSearch: () => void;
}) {
  return (
    <div className="overleaf-toolbar" role="toolbar" aria-label="Formatting">
      <ToolButton label="Undo" disabled={disabled} onClick={onUndo}><Glyph><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></Glyph></ToolButton>
      <ToolButton label="Redo" disabled={disabled} onClick={onRedo}><Glyph><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></Glyph></ToolButton>
      <span className="overleaf-toolbar__sep" aria-hidden="true" />
      <Select aria-label="Text style" value={style} disabled={disabled} onChange={(e) => onFormat(e.target.value as TextStyle)}>
        {style === "other" && <option value="other" disabled>Other</option>}
        {STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </Select>
      <span className="overleaf-toolbar__sep" aria-hidden="true" />
      {CORE.map((tool) => (
        <ToolButton key={tool.format} label={tool.label} disabled={disabled} onClick={() => onFormat(tool.format)}>{tool.icon}</ToolButton>
      ))}
      <span className="overleaf-toolbar__extra">
        {EXTRA.map((tool, i) =>
          tool === sep ? (
            <span key={`sep-${i}`} className="overleaf-toolbar__sep" aria-hidden="true" />
          ) : (
            <ToolButton key={tool.format} label={tool.label} disabled={disabled} onClick={() => onFormat(tool.format)}>{tool.icon}</ToolButton>
          ),
        )}
      </span>
      <span className="overleaf-toolbar__more">
        <Popover trigger="icon" label={<Glyph><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Glyph>} ariaLabel="More formatting" disabled={disabled}>
          {(close) => (
            <Menu
              ariaLabel="More formatting"
              onClose={close}
              items={EXTRA.filter((t): t is Tool => t !== sep).map((t) => ({ id: t.format, label: t.label, icon: t.icon, onSelect: () => onFormat(t.format) }))}
            />
          )}
        </Popover>
      </span>
      <span className="overleaf-toolbar__grow" />
      <ToolButton label="Search" onClick={onSearch}><Glyph><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Glyph></ToolButton>
    </div>
  );
}
