"use client";

import { useId, useRef, useState } from "react";
import { useDismissOnOutside } from "@/lib/use-dismiss-on-outside";

/**
 * A small "?" affordance next to a screen heading. Replaces the old muted
 * subtitle line: the same explanatory text now reveals on hover/focus (and tap
 * on touch), keeping headers compact and consistent across every screen.
 */
export function HeadingHelp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  useDismissOnOutside(open, () => setOpen(false), ref);

  return (
    <span
      className="heading-help"
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="heading-help-btn"
        aria-label="What is this?"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      <span role="tooltip" id={id} className={`heading-help-bubble${open ? " open" : ""}`}>
        {text}
      </span>
    </span>
  );
}
