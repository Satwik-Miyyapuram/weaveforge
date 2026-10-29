import { Children, Fragment, isValidElement, type ReactNode } from "react";

/** Header cells, looking through fragments so mapped columns count too. */
function countCells(node: ReactNode): number {
  return Children.toArray(node).reduce<number>((n, child) => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
      return n + countCells(child.props.children);
    }
    return n + 1;
  }, 0);
}

/**
 * A data table (design D15, DA-131). It sits in its own scroll box, so a wide
 * table scrolls inside itself rather than the page (R4.6), and its head stays
 * in view. With no rows it shows one row across every column saying why, so an
 * empty table never reads as a broken one.
 */
export function Table({
  head,
  empty,
  label,
  className,
  scrollClassName,
  children,
}: {
  /** The header cells: `<th>` or `<SortHeader>`. */
  head: ReactNode;
  /** What the empty row says. */
  empty: ReactNode;
  label?: string;
  className?: string;
  scrollClassName?: string;
  /** The body rows. */
  children: ReactNode;
}) {
  const rows = Children.toArray(children);
  return (
    <div className={scrollClassName ? `table-scroll ${scrollClassName}` : "table-scroll"}>
      <table className={className ? `cmp-table ${className}` : "cmp-table"} aria-label={label}>
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows
          ) : (
            <tr className="table-empty">
              <td colSpan={countCells(head)}>{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
