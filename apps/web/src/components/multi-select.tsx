"use client";

import { useEffect, useRef, useState } from "react";

interface Option {
  value: string;
  label: string;
}

/**
 * Checkbox dropdown for multi-value filters. Empty selection means "all". The
 * menu stays open while toggling; closes on outside click. Reuses the
 * `custom-select-*` styling.
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
  const ref = useRef<HTMLDivElement>(null);
  const set = new Set(values);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function toggle(v: string) {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange([...next]);
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
        type="button"
        id={id}
        className="custom-select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="custom-select-value">{summary}</span>
        <span className="chev">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="custom-select-menu" role="listbox" aria-multiselectable="true">
          <button
            type="button"
            className={`custom-select-item ms-item${values.length === 0 ? " sel" : ""}`}
            onClick={() => onChange([])}
          >
            <span className={`ms-check${values.length === 0 ? " on" : ""}`} aria-hidden />
            {allLabel}
          </button>
          {options.map((o) => {
            const on = set.has(o.value);
            return (
              <button
                type="button"
                key={o.value}
                role="option"
                aria-selected={on}
                className={`custom-select-item ms-item${on ? " sel" : ""}`}
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
