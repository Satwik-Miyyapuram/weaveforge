"use client";

import type { ReactNode } from "react";

/**
 * Pick one of a few options in place: Cites / Tags / Both. The chosen one is
 * pressed, not primary-coloured, so a toggle never reads as the screen's main
 * action (DA-15). For a screen's Cards / List choice use `ViewSwitch`.
 */
export function SegmentedControl<V extends string>({
  label,
  value,
  onChange,
  options,
  size = "default",
  className,
}: {
  label: string;
  value: V;
  onChange: (next: V) => void;
  /** `ariaLabel` names an option whose label is only an icon. */
  options: readonly { value: V; label: ReactNode; title?: string; ariaLabel?: string }[];
  size?: "default" | "sm";
  className?: string;
}) {
  const cls = ["seg", size === "sm" ? "seg--sm" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={cls} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          aria-label={o.ariaLabel}
          className={value === o.value ? "seg-on" : undefined}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
