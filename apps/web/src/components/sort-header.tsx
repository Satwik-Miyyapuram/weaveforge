import { Button } from "./button";
/**
 * A sortable table header (design D15). `aria-sort` sits on the header cell,
 * since a columnheader has a sort state and a button does not. The direction is
 * drawn as an icon; text arrows read out as "black up-pointing triangle".
 */
export function SortHeader({
  label,
  active,
  dir,
  onSort,
  className,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onSort: () => void;
  className?: string;
}) {
  return (
    <th className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Button variant="link" onClick={onSort}>
        {label}
        <svg
          className="sort-icon"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="currentColor"
          aria-hidden="true"
        >
          {(!active || dir === "asc") && <path d="M6 2 9.5 5.5h-7z" />}
          {(!active || dir === "desc") && <path d="M6 10 2.5 6.5h7z" />}
        </svg>
      </Button>
    </th>
  );
}
