"use client";

import type { ReactNode } from "react";
import { MultiSelect } from "@/components/multi-select";

export type FilterFacet = {
  id: string;
  /** Button text, e.g. "Tags". */
  label: string;
  /** Put before an active value's chip, e.g. "List: ". */
  chipPrefix?: string;
  values: string[];
  onChange: (next: string[]) => void;
  options: { value: string; label: string }[];
};

/**
 * The filter row Papers and Notes share: a dropdown per facet, the active
 * values as removable chips, a clear link, then `children` (e.g. a layout switch).
 * A facet with no options is left out.
 */
export function FilterRow({ label, facets, children }: { label: string; facets: FilterFacet[]; children?: ReactNode }) {
  const shown = facets.filter((f) => f.options.length > 0);
  const active = shown.some((f) => f.values.length > 0);
  return (
    <div className="filter-row" role="group" aria-label={label}>
      {shown.map((f) => (
        <MultiSelect
          key={f.id}
          id={f.id}
          className="filter-select"
          values={f.values}
          onChange={f.onChange}
          allLabel={f.label}
          ariaLabel={`Filter by ${f.label.toLowerCase()}`}
          options={f.options}
        />
      ))}
      {shown.flatMap((f) =>
        f.values.map((v) => (
          <FilterChip
            key={`${f.id}:${v}`}
            label={`${f.chipPrefix ?? ""}${f.options.find((o) => o.value === v)?.label ?? "removed"}`}
            onRemove={() => f.onChange(f.values.filter((x) => x !== v))}
          />
        )),
      )}
      {active && (
        <button type="button" className="link-btn" onClick={() => shown.forEach((f) => f.onChange([]))}>
          Clear
        </button>
      )}
      {children}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="filter-chip">
      {label}
      <button type="button" className="filter-chip-x" aria-label={`Remove filter ${label}`} onClick={onRemove}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </span>
  );
}
