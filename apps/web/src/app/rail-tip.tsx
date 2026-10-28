"use client";

import { useState, type SyntheticEvent } from "react";

/**
 * The rail's tooltip (DA-87): the name of the icon under the pointer or the
 * keyboard, shown at once beside the rail. The native `title` tip took about a
 * second and looked like the OS, not the app.
 *
 * One element for the whole rail, placed from the hovered control's box. It is
 * positioned inside the `<nav>`, because the sidebar's transform makes the nav
 * the containing block, and it sits outside the scrolling list, which would
 * clip it.
 */
const NAMED = ".nav-link, .nav-brand, .nav-collapse";

export function useRailTip(collapsed: boolean | undefined) {
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);

  function show(event: SyntheticEvent<HTMLElement>) {
    const el = collapsed ? (event.target as Element).closest<HTMLElement>(NAMED) : null;
    const text = el?.getAttribute("aria-label");
    if (!el || !text) {
      setTip(null);
      return;
    }
    const box = el.getBoundingClientRect();
    const nav = event.currentTarget.getBoundingClientRect();
    setTip({ text, top: box.top - nav.top + box.height / 2, left: box.right - nav.left + 8 });
  }
  const hide = () => setTip(null);

  return {
    handlers: { onPointerOver: show, onFocus: show, onPointerLeave: hide, onBlur: hide },
    element:
      collapsed && tip ? (
        <span className="rail-tip" role="tooltip" style={{ top: tip.top, left: tip.left }}>
          {tip.text}
        </span>
      ) : null,
  };
}
