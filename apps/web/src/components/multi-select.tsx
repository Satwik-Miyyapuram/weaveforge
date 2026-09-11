"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useDismissOnOutside } from "@/lib/hooks/use-dismiss-on-outside";
import { ChevronIcon } from "@/components/chevron-icon";

interface Option {
  value: string;
  label: string;
}

/**
 * Checkbox dropdown for multi-value filters. Empty selection means "all". The
 * menu stays open while toggling; closes on outside click. Reuses the
 * `custom-select-*` styling.
 *
 * Keyboard model, matching what a listbox of toggles is expected to do:
 *
 *  - Enter, Space or ArrowDown on the trigger opens the menu; ArrowUp opens it
 *    at the last row.
 *  - Arrow keys, Home and End move the *active* row, which carries real DOM
 *    focus. Roving focus on the option elements — rather than leaving focus on
 *    the trigger and pointing at the row with `aria-activedescendant` — is what
 *    makes assistive tech announce each option as it is reached, and it is the
 *    reason this component needs no combobox role. (`aria-activedescendant` is
 *    only meaningful on a combobox, a textbox or a group; the `Select` bug in
 *    this folder is the same rule.)
 *  - Space or Enter toggles the active row; the menu stays open, because
 *    choosing one kind of filter is not the end of choosing filters.
 *  - Escape closes and puts focus back on the trigger. Tab closes and leaves
 *    focus where it went.
 *
 * Built on the same primitives as the rest of the app — `useDismissOnOutside`
 * for the dismissal rules and the shared `custom-select-*` classes — rather than
 * on `Popover`, whose trigger is a `btn-secondary` and whose panel is a portalled
 * dialog: adopting it would restyle all nine call sites and change what a screen
 * reader announces for a filter control into a dialog.
 */
export function MultiSelect({
  id,
  values,
  options,
  onChange,
  allLabel = "All",
  ariaLabel,
  className = "",
}: {
  id?: string;
  values: string[];
  options: Option[];
  onChange: (next: string[]) => void;
  allLabel?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const listboxId = `${id ?? reactId}-listbox`;
  const set = new Set(values);

  // Row 0 is the "all" row; row n + 1 is `options[n]`. One flat index is what
  // lets the arrow keys cross from "All" into the first real option.
  const rowCount = options.length + 1;

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setActive(0);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useDismissOnOutside(open, () => close(false), ref);

  /**
   * Move focus onto the active row after it changes.
   *
   * Gated on `focusOnActive`: a keyboard move should take focus, but a mouse
   * hover sets the same state to tint the row, and yanking focus to wherever
   * the pointer happens to be would break the click that is about to land.
   */
  const focusOnActive = useRef(false);
  useEffect(() => {
    if (!open || !focusOnActive.current) return;
    focusOnActive.current = false;
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.focus();
  }, [open, active]);

  function toggle(v: string) {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange([...next]);
  }

  /** Open the menu on a given row, taking focus with it. */
  function openAt(row: number) {
    focusOnActive.current = true;
    setActive(Math.max(0, Math.min(rowCount - 1, row)));
    setOpen(true);
  }

  /** The row the menu opens on: the first selected option, else the top. */
  function firstSelectedRow(): number {
    const index = options.findIndex((option) => set.has(option.value));
    return index < 0 ? 0 : index + 1;
  }

  function activateRow(row: number) {
    if (row === 0) {
      onChange([]);
      return;
    }
    const option = options[row - 1];
    if (option) toggle(option.value);
  }

  function moveTo(row: number) {
    focusOnActive.current = true;
    setActive(Math.max(0, Math.min(rowCount - 1, row)));
  }

  /**
   * One handler for the trigger and the list.
   *
   * The options hold focus while the menu is open, so their key events bubble to
   * the list container: this is why a single function covers both, with the
   * `open` branch deciding which of the two is speaking.
   */
  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openAt(e.key === "ArrowUp" ? rowCount - 1 : firstSelectedRow());
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); moveTo(active + 1); break;
      case "ArrowUp": e.preventDefault(); moveTo(active - 1); break;
      case "Home": e.preventDefault(); moveTo(0); break;
      case "End": e.preventDefault(); moveTo(rowCount - 1); break;
      case " ":
      case "Enter": e.preventDefault(); activateRow(active); break;
      case "Escape":
        e.preventDefault();
        // Stopped here so the document-level Escape in `useDismissOnOutside`
        // does not also fire: that path closes without restoring focus, and
        // Escape is the one dismissal that must hand focus back.
        e.stopPropagation();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  }

  const summary =
    values.length === 0
      ? allLabel
      : values.length === 1
        ? options.find((o) => o.value === values[0])?.label ?? "1 selected"
        : `${values.length} selected`;

  return (
    <div className={`custom-select-container ${className}`} ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className="custom-select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        // `detail === 0` is a click the browser synthesised from a key press.
        // The keydown handler above has already opened the menu by then, so
        // acting on it too would open and immediately close it again.
        onClick={(e) => {
          if (e.detail === 0) return;
          if (open) close(false);
          else openAt(firstSelectedRow());
        }}
        onKeyDown={onKeyDown}
      >
        <span className="custom-select-value">{summary}</span>
        <ChevronIcon />
      </button>
      {open && (
        <div
          ref={listRef}
          id={listboxId}
          className="custom-select-menu"
          role="listbox"
          aria-multiselectable="true"
          aria-label={ariaLabel}
          onKeyDown={onKeyDown}
        >
          {/*
            The "all" row is an option like any other rather than an unlabelled
            button: it is selectable, it is reachable by the arrow keys, and a
            screen reader has to be able to say which row the active one is.
          */}
          <button
            type="button"
            role="option"
            data-row={0}
            tabIndex={-1}
            aria-selected={values.length === 0}
            className={`custom-select-item ms-item${values.length === 0 ? " sel" : ""}${active === 0 ? " active" : ""}`}
            onMouseEnter={() => setActive(0)}
            onClick={() => onChange([])}
          >
            <span className={`ms-check${values.length === 0 ? " on" : ""}`} aria-hidden />
            {allLabel}
          </button>
          {options.map((o, index) => {
            const on = set.has(o.value);
            const row = index + 1;
            return (
              <button
                type="button"
                key={o.value}
                role="option"
                data-row={row}
                tabIndex={-1}
                aria-selected={on}
                className={`custom-select-item ms-item${on ? " sel" : ""}${active === row ? " active" : ""}`}
                onMouseEnter={() => setActive(row)}
                onClick={() => toggle(o.value)}
              >
                <span className={`ms-check${on ? " on" : ""}`} aria-hidden />
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
