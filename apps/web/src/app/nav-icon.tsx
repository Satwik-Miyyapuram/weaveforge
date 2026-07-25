/**
 * Maps a NavItem icon handle (from each feature module) to an SVG glyph.
 * Stroke-based; visual size comes from `--nav-icon-size` via `.nav-icon`.
 * Opaque icon handles are declared in packages/core.
 */
const PATHS: Record<string, React.ReactNode> = {
  book: <path d="M4 5a2 2 0 0 1 2-2h10v16H6a2 2 0 0 0-2 2V5Zm12 14H6" />,
  list: (
    <>
      <path d="M8 6h11M8 12h11M8 18h11" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <circle cx="9" cy="18" r="2.5" />
      <path d="M8 7.5 15.5 8.5M7.5 8 8.5 15.5" />
    </>
  ),
  flask: <path d="M9 3h6M10 3v6l-5 8a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-8V3M7.5 14h9" />,
  git: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <path d="M6 8.5v7M6 12h6a3 3 0 0 0 3-3" />
    </>
  ),
  pencil: <path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 16v4ZM14.5 7.5l3 3" />,
  flag: <path d="M5 21V4m0 1h12l-3 4 3 4H5" />,
  doc: <path d="M6 3h8l4 4v14H6V3ZM14 3v4h4M9 13h6M9 17h6" />,
  notes: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14l4-2 4 2 4-2 4 2V5a2 2 0 0 0-2-2Z" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </>
  ),
  vault: (
    <>
      <path d="M4 4h16v16H4V4Z" />
      <path d="M8 4v16M4 8h12M4 12h12M4 16h12" />
    </>
  ),
  home: <path d="M4 11 12 4l8 7v9a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9Z" />,
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
