"use client";

import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useDismissOnOutside } from "@/lib/hooks/use-dismiss-on-outside";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
function parse(v: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]) - 1, Number(m[3])] : null;
}
function today(): [number, number, number] {
  const t = new Date();
  return [t.getFullYear(), t.getMonth(), t.getDate()];
}

/** Monday-first 6x7 grid of [year, month, day] around `month`. */
export function monthGrid(year: number, month: number): [number, number, number][] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, month, 1 - lead + i);
    return [d.getFullYear(), d.getMonth(), d.getDate()];
  });
}

/** Themed stand-in for `<input type="date">`, whose popup the browser draws and CSS can't reach. Value is `YYYY-MM-DD` or "". */
export function DatePicker({
  id,
  value,
  onChange,
  min,
  "aria-label": ariaLabel,
}: {
  id?: string;
  min?: string;
  value: string;
  onChange: (v: string) => void;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const sel = parse(value);
  const [view, setView] = useState<[number, number]>(() => (sel ?? today()).slice(0, 2) as [number, number]);
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden" });
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useDismissOnOutside(open, () => setOpen(false), [wrapRef, panelRef]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = btnRef.current?.getBoundingClientRect();
      const p = panelRef.current;
      if (!b || !p) return;
      const left = Math.max(12, Math.min(b.left, window.innerWidth - p.offsetWidth - 12));
      const below = b.bottom + 4;
      const top = below + p.offsetHeight > window.innerHeight - 12 && b.top - p.offsetHeight - 4 >= 12 ? b.top - p.offsetHeight - 4 : below;
      setPos({ top, left, visibility: "visible" });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const toggle = () => {
    if (!open) setView((sel ?? today()).slice(0, 2) as [number, number]);
    setOpen((o) => !o);
  };
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    btnRef.current?.focus();
  };
  const shift = (n: number) => setView(([y, m]) => [y + Math.floor((m + n) / 12), (((m + n) % 12) + 12) % 12]);

  const [vy, vm] = view;
  const now = today();
  const todayIso = iso(...now);

  return (
    <div className="custom-select-container date-picker" ref={wrapRef}>
      <button
        ref={btnRef}
        id={id}
        type="button"
        className="custom-select-button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      >
        <span className={`custom-select-value${sel ? "" : " muted"}`}>
          {sel ? `${pad(sel[2])}-${pad(sel[1] + 1)}-${sel[0]}` : "dd-mm-yyyy"}
        </span>
        <svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="Choose date"
            className="custom-select-menu custom-select-menu--fixed date-picker-panel"
            style={pos}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false);
                btnRef.current?.focus();
              }
            }}
          >
            <div className="date-picker-head">
              <button type="button" className="date-picker-nav" aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
              <span className="date-picker-title">{MONTHS[vm]} {vy}</span>
              <button type="button" className="date-picker-nav" aria-label="Next month" onClick={() => shift(1)}>›</button>
            </div>
            <div className="date-picker-grid" role="grid">
              {WEEKDAYS.map((w) => (
                <span key={w} className="date-picker-dow muted">{w}</span>
              ))}
              {monthGrid(vy, vm).map(([y, m, d]) => {
                const v = iso(y, m, d);
                const cls = ["custom-select-item", "date-picker-day"];
                if (m !== vm) cls.push("out");
                if (v === value) cls.push("sel", "sel-plain");
                if (v === todayIso) cls.push("today");
                return (
                  <button key={v} type="button" className={cls.join(" ")} aria-pressed={v === value} disabled={!!min && v < min} onClick={() => pick(v)}>
                    {d}
                  </button>
                );
              })}
            </div>
            <div className="date-picker-foot">
              <button type="button" className="btn-ghost" onClick={() => pick("")}>Clear</button>
              <button type="button" className="btn-ghost" disabled={!!min && todayIso < min} onClick={() => pick(todayIso)}>Today</button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
