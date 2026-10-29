"use client";

import type { ReactNode } from "react";

import { ToggleButton } from "./controls";

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
  className,
}: {
  label: string;
  /** null presses no option. */
  value: V | null;
  onChange: (next: V) => void;
  /** `ariaLabel` names an option whose label is only an icon. */
  options: readonly { value: V; label: ReactNode; title?: string; ariaLabel?: string }[];
  className?: string;
}) {
  const cls = className ? `wf-seg ${className}` : "wf-seg";
  return (
    <div className={cls} role="group" aria-label={label}>
      {options.map((o) => (
        <ToggleButton
          key={o.value}
          pressed={value === o.value}
          aria-label={o.ariaLabel}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </ToggleButton>
      ))}
    </div>
  );
}
