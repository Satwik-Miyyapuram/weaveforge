"use client";

/**
 * The bar's Insert and View drop-downs, and the page field.
 *
 * Insert gathers everything that puts something new on a page that is not a
 * stroke: a picture from a file, pages from a PDF, a snipped region, a text box.
 * View gathers how the page is shown: zoom levels, the two fits and rotation. Each item
 * is drawn only when its handler is handed over, so the note and the PDF reader
 * share one menu and each shows what it can do.
 */

import { useEffect, useState, type ReactNode } from "react";

import { ChevronIcon } from "@/components/chevron-icon";
import { BarMenuList, useBarMenu } from "./ink-bar-menus";
import { MenuItemButton, RowButton, ToggleButton } from "@/components/controls";

/** An Insert item that stays armed after it is picked: a tool, not an action. */
export type InkInsertTool = "clip" | "text";

export interface InsertMenuProps {
  /** The armed insert tool, if any; the trigger shows pressed while one is. */
  active?: InkInsertTool | null;
  onAddPicture?: () => void;
  /** The note's page image: under the page rather than on it. */
  onAddImage?: () => void;
  hasPageBackground?: boolean;
  onRemovePageBackground?: () => void;
  onInsertPage?: () => void;
  onClip?: () => void;
  onTextBox?: () => void;
}

export function hasInsertItems(props: InsertMenuProps): boolean {
  return Boolean(
    props.onAddPicture ||
      props.onAddImage ||
      props.onInsertPage ||
      props.onClip ||
      props.onTextBox ||
      (props.hasPageBackground && props.onRemovePageBackground),
  );
}

export function InsertMenu({
  active = null,
  onAddPicture,
  onAddImage,
  hasPageBackground = false,
  onRemovePageBackground,
  onInsertPage,
  onClip,
  onTextBox,
}: InsertMenuProps) {
  const { open, setOpen, menuRef, listRef, pos, choose } = useBarMenu();
  const picture = onAddPicture ?? onAddImage;

  return (
    <div className="ink-menu ink-menu-insert" ref={open ? menuRef : undefined}>
      <ToggleButton pressed={active !== null}
        className="ink-tool ink-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Insert"
        title="Insert a picture, a snip or a text box"
        onClick={() => setOpen((was) => !was)}
      >
        {active === "clip" ? <ClipGlyph /> : active === "text" ? <TextGlyph /> : <ImageGlyph />}
        <Caret open={open} />
      </ToggleButton>
      {open ? (
        <BarMenuList label="Insert" className="ink-menu-insert-list" listRef={listRef} pos={pos}>
          {picture ? (
            <MenuItemButton className="ink-menu-item" onClick={choose(picture)}>
              <ImageGlyph />
              <span>
                {onAddPicture ? "Image from file…" : hasPageBackground ? "Change the page image…" : "Page image from file…"}
              </span>
            </MenuItemButton>
          ) : null}
          {hasPageBackground && onRemovePageBackground ? (
            <MenuItemButton className="ink-menu-item" onClick={choose(onRemovePageBackground)}>
              <ImageOffGlyph />
              <span>Remove the page image</span>
            </MenuItemButton>
          ) : null}
          {onInsertPage ? (
            <MenuItemButton className="ink-menu-item" onClick={choose(onInsertPage)}>
              <PdfGlyph />
              <span>Pages from a PDF or image…</span>
            </MenuItemButton>
          ) : null}
          {onClip ? (
            <MenuItemButton kind="radio" checked={active === "clip"}
              className="ink-menu-item"
              onClick={choose(onClip)}
            >
              <ClipGlyph />
              <span>Snip a region</span>
            </MenuItemButton>
          ) : null}
          {onTextBox ? (
            <MenuItemButton kind="radio" checked={active === "text"}
              className="ink-menu-item"
              onClick={choose(onTextBox)}
            >
              <TextGlyph />
              <span>Text box</span>
            </MenuItemButton>
          ) : null}
          {onAddPicture ? (
            <p className="ink-menu-hint">Or paste an image, or drop one on the page.</p>
          ) : null}
        </BarMenuList>
      ) : null}
    </div>
  );
}

export interface ViewMenuProps {
  /** The zoom, as a percentage, shown on the trigger. */
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Jump to one of the preset levels, as a percentage. */
  onZoomTo?: (percent: number) => void;
  /** Which fit is in force; "custom" once the reader zooms by hand. */
  fit?: "width" | "page" | "custom";
  /** Fit the PDF page itself, not the pane's padding or the ink margin. */
  onFitPage?: () => void;
  onFitWidth?: () => void;
  onRotate?: () => void;
  /**
   * Whether each PDF page sits beside a page as wide as itself to write on. A
   * setting rather than a side effect of the pen, so the layout holds still:
   * taking the pen out or putting it away no longer turns one page into two.
   */
  writingPage?: boolean;
  onWritingPage?: (on: boolean) => void;
}

/** The levels the zoom menu offers. */
export const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200] as const;

/**
 * Zoom out, the level, zoom in. The level is a plain ghost button that opens
 * the presets, the two fits and rotation; the steps sit outside it so a run of
 * presses needs no menu.
 */
export function ViewMenu({
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onZoomTo,
  fit,
  onFitPage,
  onFitWidth,
  onRotate,
  writingPage,
  onWritingPage,
}: ViewMenuProps) {
  const { open, setOpen, menuRef, listRef, pos, choose } = useBarMenu();
  const fits = Boolean(onFitPage || onFitWidth);

  return (
    <div className="ink-zoom">
      <RowButton className="ink-tool ink-zoom-step" aria-label="Zoom out" title="Zoom out" onClick={onZoomOut}>
        <ZoomGlyph />
      </RowButton>
      <div className="ink-menu ink-menu-view" ref={open ? menuRef : undefined}>
        <RowButton
          className="ink-zoom-pct"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Zoom ${zoomPercent}%, fit and rotate`}
          title="Zoom, fit and rotate"
          onClick={() => setOpen((was) => !was)}
        >
          {zoomPercent}%
          <Caret open={open} />
        </RowButton>
        {open ? (
          <BarMenuList label="View" className="ink-menu-view-list" listRef={listRef} pos={pos}>
            {onZoomTo ? <ZoomPresets zoomPercent={zoomPercent} onZoomTo={onZoomTo} onChosen={() => setOpen(false)} /> : null}
            {onZoomTo && (fits || onRotate) ? <hr className="ink-menu-rule" /> : null}
            {onFitWidth ? (
              <MenuItemButton kind="radio" checked={fit === "width"}
                className="ink-menu-item"
                onClick={choose(onFitWidth)}
              >
                <FitGlyph />
                <span>Fit width</span>
              </MenuItemButton>
            ) : null}
            {onFitPage ? (
              <MenuItemButton kind="radio" checked={fit === "page"}
                className="ink-menu-item"
                onClick={choose(onFitPage)}
              >
                <FitGlyph page />
                <span>Fit page</span>
              </MenuItemButton>
            ) : null}
            {fits && onRotate ? <hr className="ink-menu-rule" /> : null}
            {onRotate ? (
              <MenuItemButton className="ink-menu-item" onClick={choose(onRotate)}>
                <RotateGlyph />
                <span>Rotate</span>
                <kbd>R</kbd>
              </MenuItemButton>
            ) : null}
            {onWritingPage ? (
              <>
                {fits || onRotate || onZoomTo ? <hr className="ink-menu-rule" /> : null}
                <WritingPageItem on={Boolean(writingPage)} onChange={choose(() => onWritingPage(!writingPage))} />
              </>
            ) : null}
          </BarMenuList>
        ) : null}
      </div>
      <RowButton className="ink-tool ink-zoom-step" aria-label="Zoom in" title="Zoom in" onClick={onZoomIn}>
        <ZoomGlyph plus />
      </RowButton>
    </div>
  );
}

/** The writing-page switch, as a checked menu item. */
export function WritingPageItem({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <MenuItemButton kind="checkbox" checked={on} className="ink-menu-item" onClick={onChange}>
      <WritingPageGlyph />
      <span>Writing page beside each page</span>
    </MenuItemButton>
  );
}

/** The fixed zoom levels, as menu items; the current one is checked. */
export function ZoomPresets({
  zoomPercent,
  onZoomTo,
  onChosen,
}: {
  zoomPercent: number;
  onZoomTo: (percent: number) => void;
  onChosen?: () => void;
}) {
  return (
    <>
      {ZOOM_PRESETS.map((level) => (
        <MenuItemButton kind="radio" checked={zoomPercent === level}
          key={level}
          className="ink-menu-item"
          onClick={() => {
            onChosen?.();
            onZoomTo(level);
          }}
        >
          <span>{`${level}%`}</span>
        </MenuItemButton>
      ))}
    </>
  );
}

/**
 * The page number, typed. The draft is the field's own so it can be cleared
 * while typing; a number goes to the page at once, and the field settles on
 * the clamped page when it loses focus or Enter is pressed. A blank or a
 * non-number puts the current page back.
 */
export function PageField({
  page,
  pages,
  onGoToPage,
}: {
  page: number;
  pages: number;
  onGoToPage: (page: number) => void;
}) {
  const [draft, setDraft] = useState(String(page));
  useEffect(() => {
    setDraft(String(page));
  }, [page]);

  function commit(raw: string) {
    const trimmed = raw.trim();
    const next = Number(trimmed);
    if (trimmed === "" || !Number.isFinite(next)) {
      setDraft(String(page));
      return;
    }
    const clamped = Math.min(pages, Math.max(1, Math.round(next)));
    onGoToPage(clamped);
    setDraft(String(clamped));
  }

  return (
    <input
      className="ink-page-now ink-page-input"
      type="number"
      inputMode="numeric"
      min={1}
      max={pages}
      value={draft}
      aria-label="Page number"
      onChange={(event) => {
        const value = event.target.value;
        setDraft(value);
        const next = Number(value);
        if (value.trim() !== "" && Number.isFinite(next)) {
          onGoToPage(Math.min(pages, Math.max(1, Math.round(next))));
        }
      }}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit(event.currentTarget.value);
      }}
    />
  );
}

function Svg({ size = 15, width = 2, children }: { size?: number; width?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function Caret({ open, size = 12 }: { open?: boolean; size?: number }) {
  return <ChevronIcon open={open} size={size} className="ink-menu-caret" />;
}

/** The text cursor: Select, which picks text to highlight, underline or comment. */
export function SelectGlyph() {
  return (
    <Svg size={16}>
      <path d="M9 4h6M9 20h6M12 4v16" />
    </Svg>
  );
}

/** The mouse pointer: notes' Cursor, which points and picks figures. */
export function PointerGlyph() {
  return (
    <Svg size={16}>
      <path d="M5 3l14 8-6 1.5L10 19z" />
    </Svg>
  );
}

export function ClipGlyph() {
  return (
    <Svg>
      <path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2" />
    </Svg>
  );
}

export function TextGlyph() {
  return (
    <Svg>
      <path d="M5 6V4h14v2M12 4v16M9 20h6" />
    </Svg>
  );
}

export function ImageGlyph() {
  return (
    <Svg>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </Svg>
  );
}

function ImageOffGlyph() {
  return (
    <Svg>
      <path d="M21 13V5a2 2 0 0 0-2-2H8M3 7v12a2 2 0 0 0 2 2h12" />
      <path d="m2 2 20 20" />
    </Svg>
  );
}

function PdfGlyph() {
  return (
    <Svg>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h5" />
    </Svg>
  );
}

function FitGlyph({ page = false }: { page?: boolean }) {
  return page ? (
    <Svg>
      <rect x="5.5" y="2" width="13" height="20" rx="2" />
      <path d="M12 6v12M10 8l2-2 2 2M10 16l2 2 2-2" />
    </Svg>
  ) : (
    <Svg>
      <rect x="2" y="5.5" width="20" height="13" rx="2" />
      <path d="M6 12h12M8 10l-2 2 2 2M16 10l2 2-2 2" />
    </Svg>
  );
}

function RotateGlyph() {
  return (
    <Svg width={2.2}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.85.83 6.72 2.24" />
      <path d="M21 3v5h-5" />
    </Svg>
  );
}

/** Two pages side by side: the PDF's, and the blank one beside it. */
function WritingPageGlyph() {
  return (
    <Svg width={2.2}>
      <rect x="3" y="4" width="8" height="16" rx="1" />
      <rect x="13" y="4" width="8" height="16" rx="1" />
    </Svg>
  );
}

function ZoomGlyph({ plus = false }: { plus?: boolean }) {
  return (
    <Svg size={14} width={2.6}>
      <path d="M5 12h14" />
      {plus ? <path d="M12 5v14" /> : null}
    </Svg>
  );
}
