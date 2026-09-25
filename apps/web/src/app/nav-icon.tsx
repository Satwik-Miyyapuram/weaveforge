/**
 * Maps a NavItem icon handle (from each feature module) to an SVG glyph.
 * Stroke-based; visual size comes from `--nav-icon-size` via `.nav-icon`.
 * Opaque icon handles are declared in packages/core.
 */
const PATHS: Record<string, React.ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  book: <path d="M4 5a2 2 0 0 1 2-2h10v16H6a2 2 0 0 0-2 2V5Zm12 14H6" />,
  list: (
    <>
      <path d="M8 6h11M8 12h11M8 18h11" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </>
  ),
  /* A hub and its spokes: a web of links. Drawn so it cannot be mistaken for
   * `git`, whose branch glyph the earlier three-node version nearly copied. */
  graph: (
    <>
      <circle cx="12" cy="12" r="2.2" />
      <circle cx="5" cy="5" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18.5" cy="18.5" r="2" />
      <path d="M6.5 6.5 10.4 10.4M17.4 7.2 13.6 10.6M7.5 17.5l3-3.9M13.6 13.6l3.5 3.5" />
    </>
  ),
  flask: (
    <path d="M9 3h6M10 3v6l-5 8a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-8V3M7.5 14h9" />
  ),
  /* Overleaf's actual mark, filled, on the shared 24-unit grid.
   *
   * This is the real path from Overleaf's logo — taken from the Simple Icons
   * set (`simple-icons/icons/overleaf.svg`, the project's canonical trace of the
   * brand) rather than drawn by hand. The version before it was three stroke
   * paths that approximated a leaf, which is why it read as a generic leaf: the
   * brand is a *solid* form, and no amount of stroking an outline produces it.
   *
   * No scale or translate wrapper. The official glyph is already drawn to fill
   * `0 0 24 24` — the same box every other icon in this file uses — so it needs
   * no optical correction, and adding one would make it smaller than its
   * neighbours for no reason. That is the difference between this and the
   * hand-drawn attempt, which needed scaling to stop its solid mass reading
   * heavier than the strokes beside it.
   *
   * **Colour: `currentColor`, not Overleaf's green.** The brand colour is
   * `#47A141` (what Simple Icons ships). It is deliberately not used: this
   * column is monochrome by rule — every glyph takes the row's colour, `--muted`
   * at rest and `--active-fg` when selected — and a permanently green icon would
   * be the one item in the sidebar that ignores the theme, is near-invisible in
   * dark mode, and loses its contrast guarantee. `check:contrast` would also have
   * nothing to measure it against, since it reads the pairs the theme declares.
   *
   * `fill` and `stroke` are set on the path itself, not through a class. The
   * `<svg>` sets both as presentation attributes, and any stylesheet rule beats
   * a presentation attribute — so `stroke="none"` here is what stops the parent's
   * 1.7px stroke from outlining a shape that is meant to be solid. */
  overleaf: (
    <path
      fill="currentColor"
      stroke="none"
      d="M22.3515.7484C19.1109-.5101 7.365-.982 7.3452 6.0266c-3.4272 2.194-5.6967 5.768-5.6967 9.598a8.373 8.373 0 0 0 13.1225 6.898 8.373 8.373 0 0 0-1.7668-14.7194c-.6062-.2339-1.9234-.6481-2.9753-.559-1.5007.9544-3.3308 2.9155-4.1949 4.8693 2.5894-3.082 7.5046-2.425 9.1937 1.2287 1.6892 3.6538-.9944 7.8237-5.0198 7.7998a5.4995 5.4995 0 0 1-4.1949-1.9328c-1.485-1.7483-1.8678-3.6444-1.5615-5.4975 1.057-6.4947 8.759-10.1894 14.486-11.6094-1.8677.989-5.2373 2.6134-7.5948 4.3837C18.015 9.1382 19.1308 3.345 22.3515.7484z"
    />
  ),
  git: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <path d="M6 8.5v7M6 12h6a3 3 0 0 0 3-3" />
    </>
  ),
  pencil: <path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 16v4ZM14.5 7.5l3 3" />,
  /* A dated page, for the log: it is a journal, and sharing the editor's pencil
   * put two different screens behind one glyph. */
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h6" />
    </>
  ),
  flag: <path d="M5 21V4m0 1h12l-3 4 3 4H5" />,
  doc: <path d="M6 3h8l4 4v14H6V3ZM14 3v4h4M9 13h6M9 17h6" />,
  notes: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14l4-2 4 2 4-2 4 2V5a2 2 0 0 0-2-2Z" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </>
  ),
  folder: (
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h9A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z" />
  ),
  ink: (
    <>
      <path d="m12 19 7-7 3 3-7 7-3-3z" />
      <path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="m2 2 7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </>
  ),
  home: (
    <path d="M4 11 12 4l8 7v9a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9Z" />
  ),
};

export function NavIcon({ name }: { name?: string }) {
  const glyph = (name && PATHS[name]) ?? PATHS.doc;
  return (
    <svg
      className="nav-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph}
    </svg>
  );
}
