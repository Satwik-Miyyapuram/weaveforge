"use client";

import React, { useId, useState, useRef, useEffect } from "react";
import { useDismissOnOutside } from "@/lib/hooks/use-dismiss-on-outside";
import { createPortal } from "react-dom";
import { ChevronIcon } from "@/components/chevron-icon";
import { anchoredMenuStyle, useAnchoredMenu } from "@/lib/hooks/use-anchored-menu";

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  onChange?: (e: { target: { value: string } }) => void;
  /** Show a filter box at the top of the menu (for long option lists). */
  searchable?: boolean;
  searchPlaceholder?: string;
}

interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
  group?: string;
}

function pushOption(out: SelectOption[], child: React.ReactElement, group?: string) {
  const v = child.props.value !== undefined ? child.props.value : child.props.children;
  out.push({
    value: String(v),
    label: child.props.children,
    disabled: Boolean(child.props.disabled),
    group,
  });
}

/** Flatten direct <option> and nested <optgroup> children into selectable rows. */
function collectOptions(children: React.ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === "option") {
      pushOption(options, child);
      return;
    }
    if (child.type === "optgroup") {
      const group = String(child.props.label ?? "");
      React.Children.forEach(child.props.children, (opt) => {
        if (React.isValidElement(opt) && opt.type === "option") pushOption(options, opt, group);
      });
    }
  });
  return options;
}

function optionText(label: React.ReactNode): string {
  if (typeof label === "string" || typeof label === "number") return String(label);
  return "";
}

export function Select({
  id,
  value,
  onChange,
  className = "",
  disabled,
  children,
  "aria-label": ariaLabel,
  searchable = false,
  searchPlaceholder = "Search…",
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const baseId = id ?? reactId;
  /** Named by the trigger's `aria-controls`, which is what makes the popup a
   *  labelled part of the combobox rather than an anonymous listbox. */
  const listboxId = `${baseId}-listbox`;

  // Status dropdowns carry a per-value color (status-<value> classes). When this
  // is a status select, tint the trigger by the selected value and give the
  // selected menu item a colored box in that value's color.
  const isStatus = className.includes("status-select");
  const val = String(value ?? "");

  const options = collectOptions(children);
  const q = query.trim().toLowerCase();
  const visible = options
    .map((opt, index) => ({ opt, index }))
    .filter(({ opt }) => {
      if (opt.disabled || opt.value === "") return !q;
      if (!q) return true;
      const text = optionText(opt.label).toLowerCase();
      const group = (opt.group ?? "").toLowerCase();
      return text.includes(q) || group.includes(q);
    });

  const selectedIndex = options.findIndex((o) => o.value === val);
  const selectedOption = options[selectedIndex];
  const buttonClass = `custom-select-button${isStatus ? ` status-${val}` : ""}`;

  // Portalled and fixed so a scrolling or clipping ancestor (the PDF toolbar) can't trap the menu.
  const { rect: menuRect, up: openUp, place: placeMenu } = useAnchoredMenu(
    open,
    buttonRef,
    listRef,
    searchable ? 320 : 260,
    query,
  );

  // Both refs: the menu is portalled out of the container, so a click inside it
  // would otherwise read as "outside" and close before the option registers.
  useDismissOnOutside(
    open,
    () => {
      setOpen(false);
      setQuery("");
    },
    [containerRef, listRef],
  );

  // Keep the active (keyboard-highlighted) option scrolled into view.
  useEffect(() => {
    if (open && active >= 0) {
      listRef.current
        ?.querySelector(`[data-visible-idx="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [active, open]);

  useEffect(() => {
    if (open && searchable) {
      const id = requestAnimationFrame(() => searchRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open, searchable]);

  function openMenu() {
    placeMenu();
    const visibleSelected = visible.findIndex(({ index }) => index === selectedIndex);
    setActive(visibleSelected >= 0 ? visibleSelected : nextSelectableInVisible(0, 1));
    setQuery("");
    setOpen(true);
  }

  function closeMenu() {
    setOpen(false);
    setQuery("");
    buttonRef.current?.focus();
  }

  function chooseVisible(i: number) {
    const row = visible[i];
    if (!row || row.opt.disabled) return;
    onChange?.({ target: { value: row.opt.value } });
    closeMenu();
  }

  function nextSelectableInVisible(from: number, dir: 1 | -1): number {
    let i = from;
    while (i >= 0 && i < visible.length) {
      if (!visible[i]?.opt.disabled && visible[i]?.opt.value !== "") return i;
      i += dir;
    }
    return Math.max(0, Math.min(from, visible.length - 1));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (searchable && e.target === searchRef.current) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => nextSelectableInVisible(Math.min(visible.length - 1, Math.max(-1, a) + 1), 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => nextSelectableInVisible(Math.max(0, Math.max(0, a) - 1), -1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        chooseVisible(active);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => nextSelectableInVisible(Math.min(visible.length - 1, a + 1), 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => nextSelectableInVisible(Math.max(0, a - 1), -1));
        break;
      case "Home": e.preventDefault(); setActive(nextSelectableInVisible(0, 1)); break;
      case "End": e.preventDefault(); setActive(nextSelectableInVisible(visible.length - 1, -1)); break;
      case "Enter":
      case " ": e.preventDefault(); chooseVisible(active); break;
      case "Escape": e.preventDefault(); closeMenu(); break;
      case "Tab": setOpen(false); setQuery(""); break;
    }
  }

  return (
    <div className={`custom-select-container ${className}`} ref={containerRef}>
      {/*
        The trigger is a combobox, not a plain button.
        `aria-activedescendant` — which this needs while the menu is open, because
        focus stays on the trigger and the highlighted row is only described by it
        — is supported on a combobox, a textbox and a group, and *not* on a
        button. It was set on a `role=button` trigger, so assistive tech was
        entitled to ignore it and the keyboard highlight went unannounced.
        `role="combobox"` with `aria-expanded` and `aria-controls` pointing at the
        listbox is the documented select-only pattern; `aria-haspopup="listbox"`
        is dropped because it is the implicit value for combobox.
      */}
      <button
        ref={buttonRef}
        type="button"
        id={id}
        className={buttonClass}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-controls={open && menuRect ? listboxId : undefined}
        aria-autocomplete={searchable ? "list" : undefined}
        aria-activedescendant={
          open && active >= 0 && visible[active]
            ? `${baseId}-opt-${visible[active].index}`
            : undefined
        }
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="custom-select-value">{selectedOption ? selectedOption.label : ""}</span>
        <ChevronIcon />
      </button>
      {open && menuRect && createPortal(
        <div
          ref={listRef}
          id={listboxId}
          // The caller's class rides along: the menu is portalled out of the
          // container, so per-instance rules that were written as descendants
          // (`.status-select .custom-select-menu`) would otherwise stop matching.
          className={`custom-select-menu custom-select-menu--fixed${className ? ` ${className}` : ""}${openUp ? " up" : ""}${searchable ? " searchable" : ""}`}
          role="listbox"
          onKeyDown={onKeyDown}
          style={anchoredMenuStyle(menuRect)}
        >
          {searchable && (
            <div className="custom-select-search">
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(nextSelectableInVisible(0, 1));
                }}
                onKeyDown={onKeyDown}
              />
            </div>
          )}
          {visible.length === 0 ? (
            <div className="custom-select-empty muted">No matches</div>
          ) : (
            visible.map(({ opt, index }, i) => {
              const sel = opt.value === val;
              const showGroup = opt.group && (i === 0 || visible[i - 1]?.opt.group !== opt.group);
              const itemClass =
                "custom-select-item" +
                (sel ? " sel" : "") +
                (sel ? (isStatus ? ` status-${opt.value}` : " sel-plain") : "") +
                (i === active ? " active" : "") +
                (opt.disabled ? " disabled" : "");
              return (
                <React.Fragment key={`${opt.group ?? ""}:${opt.value}:${index}`}>
                  {showGroup ? (
                    <div className="custom-select-group" role="presentation">
                      {opt.group}
                    </div>
                  ) : null}
                  <div
                    role="option"
                    id={`${baseId}-opt-${index}`}
                    data-visible-idx={i}
                    aria-selected={sel}
                    aria-disabled={opt.disabled || undefined}
                    className={itemClass}
                    onMouseEnter={() => !opt.disabled && setActive(i)}
                    onClick={() => chooseVisible(i)}
                  >
                    {opt.label}
                  </div>
                </React.Fragment>
              );
            })
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
