type Span = { top: number; bottom: number };

/** The scrollTop that shows `row` whole inside `view`, moving as little as possible. */
export function scrollTopToReveal(row: Span, view: Span, scrollTop: number): number {
  if (row.top < view.top) return scrollTop - (view.top - row.top);
  if (row.bottom > view.bottom) return scrollTop + (row.bottom - view.bottom);
  return scrollTop;
}

/** Scroll the sidebar so its current destination is not hidden below the fold. */
export function revealActiveNav(scroller: HTMLElement | null): void {
  const row = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
  if (!scroller || !row) return;
  const next = scrollTopToReveal(row.getBoundingClientRect(), scroller.getBoundingClientRect(), scroller.scrollTop);
  if (next !== scroller.scrollTop) scroller.scrollTop = next;
}
