"use client";

import type { ReactNode } from "react";

/** The view choice at the end of a screen's filter row, e.g. Cards / List. */
export function ViewSwitch<V extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: V;
  onChange: (next: V) => void;
  options: readonly { value: V; label: string; icon: ReactNode }[];
}) {
  return (
    <div className="seg view-switch" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? "seg-on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
