import type { ReactNode } from "react";

/**
 * The header every list screen opens with: an optional title, a row of
 * actions, and whatever status line the screen wants under them.
 *
 * Nine screens hand-wrote the same three nested divs, so the markup drifted
 * (some kept the title inside the row, some outside) even though the CSS
 * expects one shape.
 */
export function ScreenHead({
  title,
  note,
  children,
}: {
  title?: string;
  /** Status line under the actions, e.g. the result of a sync. */
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="screen-head">
      <div className="head-row">
        {title ? <h1 className="screen-title">{title}</h1> : null}
        <div className="screen-actions">{children}</div>
      </div>
      {note}
    </header>
  );
}
