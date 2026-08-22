"use client";

import type { ReactNode } from "react";
import { Popover } from "@/components/popover";
import { FilterIcon } from "@/components/view-icons";
import { MultiSelect } from "@/components/multi-select";

/**
 * The filter popover papers and notes share: list, tags, and a clear link.
 *
 * A screen with filters of its own (paper status) passes them as `children`;
 * they render above the two every list-and-tag screen has. `idPrefix` keeps
 * the field ids unique when two of these ever share a page.
 */
export function ListTagFilters({
  idPrefix,
  lists,
  listFilter,
  onListFilter,
  allTags,
  tagFilter,
  onTagFilter,
  activeFilters,
  onClear,
  children,
}: {
  idPrefix: string;
  lists: readonly { id: string; name: string }[];
  listFilter: string[];
  onListFilter: (next: string[]) => void;
  allTags: readonly string[];
  tagFilter: string[];
  onTagFilter: (next: string[]) => void;
  activeFilters: number;
  onClear: () => void;
  children?: ReactNode;
}) {
  return (
    <Popover label={<FilterIcon />} ariaLabel="Filters" iconOnly count={activeFilters} align="right">
      <div className="filters">
        {children}
        {lists.length > 0 && (
          <MultiSelect
            id={`${idPrefix}list`}
            values={listFilter}
            onChange={onListFilter}
            allLabel="All lists"
            ariaLabel="Filter by list"
            options={lists.map((l) => ({ value: l.id, label: l.name }))}
          />
        )}
        {allTags.length > 0 && (
          <MultiSelect
            id={`${idPrefix}tags`}
            values={tagFilter}
            onChange={onTagFilter}
            allLabel="All tags"
            ariaLabel="Filter by tags"
            options={allTags.map((t) => ({ value: t, label: `#${t}` }))}
          />
        )}
        {activeFilters > 0 && (
          <button type="button" className="link-btn" onClick={onClear}>
            Clear filters
          </button>
        )}
      </div>
    </Popover>
  );
}
