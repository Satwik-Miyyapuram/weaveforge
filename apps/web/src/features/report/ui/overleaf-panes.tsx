import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ToolButton } from "@/components/controls";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/view-icons";

export type PaneLayout = "split" | "editor" | "pdf";

const SIDE_MIN = 150;
const SIDE_MAX = 480;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A draggable rail between two panes, with Overleaf's arrow buttons to fold them. */
function Divider({
  label,
  value,
  onStep,
  onDrag,
  children,
}: {
  label: string;
  value: number;
  onStep: (direction: -1 | 1) => void;
  onDrag: ((clientX: number) => void) | null;
  children: ReactNode;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement> | { key: string; preventDefault(): void }) => {
    if (!onDrag || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    onStep(event.key === "ArrowLeft" ? -1 : 1);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!onDrag || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  /** Captured moves are the drag; capture ends on release or cancel. */
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (onDrag && event.currentTarget.hasPointerCapture(event.pointerId)) onDrag(event.clientX);
  };
  return (
    <div
      className={`overleaf-divider${onDrag ? "" : " overleaf-divider--fixed"}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      tabIndex={onDrag ? 0 : -1}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      {children}
    </div>
  );
}

/**
 * Overleaf's editor frame: file rail, source and PDF side by side, flush, with
 * dividers that drag to resize and arrows that fold a pane away. Folding the
 * editor or the PDF picks Overleaf's PDF-only or editor-only layout; hidden
 * panes stay mounted, so the connection and the PDF survive.
 */
export function OverleafPanes({
  layout,
  onLayout,
  sidebar,
  editor,
  pdf,
}: {
  layout: PaneLayout;
  onLayout: (layout: PaneLayout) => void;
  sidebar: ReactNode;
  editor: ReactNode;
  pdf: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [sideOpen, setSideOpen] = useState(true);
  const [sideWidth, setSideWidth] = useState(220);
  /** The editor's share of the room the editor and PDF split. */
  const [ratio, setRatio] = useState(0.5);
  const box = () => hostRef.current?.getBoundingClientRect();

  const dragSide = (clientX: number) => {
    const rect = box();
    if (rect) setSideWidth(clamp(clientX - rect.left, SIDE_MIN, SIDE_MAX));
  };
  const dragMain = (clientX: number) => {
    const rect = box();
    if (!rect) return;
    const start = rect.left + (sideOpen ? sideWidth : 0);
    const room = rect.right - start;
    if (room > 0) setRatio(clamp((clientX - start) / room, 0.15, 0.85));
  };

  return (
    <div ref={hostRef} className={`overleaf-panes overleaf-panes--${layout}`}>
      <div className="overleaf-panes__side" hidden={!sideOpen} style={{ width: sideWidth }}>{sidebar}</div>
      <Divider
        label="Resize file tree"
        value={sideOpen ? sideWidth : 0}
        onStep={(d) => setSideWidth((w) => clamp(w + d * 16, SIDE_MIN, SIDE_MAX))}
        onDrag={sideOpen ? dragSide : null}
      >
        {sideOpen ? (
          <ToolButton label="Hide file tree" onClick={() => setSideOpen(false)}><ChevronLeftIcon size={12} /></ToolButton>
        ) : (
          <ToolButton label="Show file tree" onClick={() => setSideOpen(true)}><ChevronRightIcon size={12} /></ToolButton>
        )}
      </Divider>
      <div className="overleaf-panes__editor" hidden={layout === "pdf"} style={{ flexGrow: layout === "split" ? ratio : 1 }}>{editor}</div>
      <Divider
        label="Resize editor and PDF"
        value={Math.round(ratio * 100)}
        onStep={(d) => setRatio((r) => clamp(r + d * 0.05, 0.15, 0.85))}
        onDrag={layout === "split" ? dragMain : null}
      >
        {layout !== "pdf" && (
          <ToolButton label={layout === "split" ? "Hide editor" : "Show PDF"} onClick={() => onLayout(layout === "split" ? "pdf" : "split")}>
            <ChevronLeftIcon size={12} />
          </ToolButton>
        )}
        {layout !== "editor" && (
          <ToolButton label={layout === "split" ? "Hide PDF" : "Show editor"} onClick={() => onLayout(layout === "split" ? "editor" : "split")}>
            <ChevronRightIcon size={12} />
          </ToolButton>
        )}
      </Divider>
      <div className="overleaf-panes__pdf" hidden={layout === "editor"} style={{ flexGrow: layout === "split" ? 1 - ratio : 1 }}>{pdf}</div>
    </div>
  );
}
