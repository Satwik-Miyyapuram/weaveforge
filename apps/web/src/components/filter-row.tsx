"use client";

import type { ReactNode } from "react";
import { MultiSelect } from "@/components/multi-select";
import { Button } from "./button";
import { Chip } from "./controls";

/** Chips drawn before the rest fold into "+N others", keeping the row short. */
const SHOWN_CHIPS = 2;

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
 * values as removable chips (the first few; the rest fold into "+N others"),
 * a clear link, then `children` (e.g. a layout switch).
 * A facet with no options is left out.
 */
export function FilterRow({ label, facets, children }: { label: string; facets: FilterFacet[]; children?: ReactNode }) {
  const shown = facets.filter((f) => f.options.length > 0);
  const chips = shown.flatMap((f) =>
    f.values.map((v) => ({
      key: `${f.id}:${v}`,
      label: `${f.chipPrefix ?? ""}${f.options.find((o) => o.value === v)?.label ?? "removed"}`,
      remove: () => f.onChange(f.values.filter((x) => x !== v)),
    })),
  );
  const hidden = chips.slice(SHOWN_CHIPS);
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
      {chips.slice(0, SHOWN_CHIPS).map((c) => (
        <FilterChip key={c.key} label={c.label} onRemove={c.remove} />
      ))}
      {hidden.length > 0 && (
        <Chip title={hidden.map((c) => c.label).join(", ")}>
          +{hidden.length} {hidden.length === 1 ? "other" : "others"}
        </Chip>
      )}
      {chips.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => shown.forEach((f) => f.onChange([]))}>
          Clear
        </Button>
      )}
      {children}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Chip onRemove={onRemove} removeLabel={`Remove filter ${label}`}>
      {label}
    </Chip>
  );
}
