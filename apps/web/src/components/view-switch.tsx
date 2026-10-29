"use client";

import type { ReactNode } from "react";

import { TabButton } from "./controls";

/**
 * The view choice at the end of a screen's filter row, e.g. Cards / List, and
 * any other pick-a-view tab strip. `value` null selects no tab (a collapsed
 * sidebar).
 */
export function ViewSwitch<V extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: V | null;
  onChange: (next: V) => void;
  options: readonly { value: V; label: ReactNode; icon?: ReactNode; title?: string }[];
  className?: string;
}) {
  return (
    <div className={className ? `wf-seg view-switch ${className}` : "wf-seg view-switch"} role="tablist" aria-label={label}>
      {options.map((o) => (
        <TabButton
          key={o.value}
          selected={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </TabButton>
      ))}
    </div>
  );
}
