/**
 * The brand mark, inlined rather than referenced as `<img src=…>`.
 *
 * An SVG loaded through `<img>` is an isolated document: the host page's custom
 * properties do not cross into it, so the mark always rendered in its light-mode
 * fallback colours no matter which theme was active. Inlining puts the shapes in
 * the page's own DOM, where the cascade reaches them.
 *
 * Paints straight from the theme tokens — no logo-specific colours exist, so
 * the mark cannot drift from the rest of the UI.
 *
 * The static file at /icons/weave_forge.svg is kept for the favicon and apple
 * touch icon, which the browser fetches outside any page and cannot theme.
 */
export function WeaveForgeLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="WeaveForge"
    >
      <rect width="512" height="512" rx="115" fill="var(--surface2)" />

      <path
        d="M 230 125 L 194 125 A 54 54 0 0 0 140 179 L 140 355 A 54 54 0 0 0 194 409 L 318 409 A 54 54 0 0 0 372 355 L 372 265"
        fill="none"
        stroke="var(--text)"
        strokeWidth="22"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <line x1="264" y1="125" x2="264" y2="215" stroke="var(--text)" strokeWidth="12" strokeLinecap="round" />
      <line x1="264" y1="215" x2="356" y2="139" stroke="var(--text)" strokeWidth="12" strokeLinecap="round" />
      <line x1="264" y1="215" x2="372" y2="229" stroke="var(--text)" strokeWidth="12" strokeLinecap="round" />

      <circle cx="264" cy="125" r="22" fill="var(--text)" />
      <circle cx="264" cy="215" r="22" fill="var(--text)" />
      <circle cx="356" cy="139" r="22" fill="var(--accent)" />
      <circle cx="372" cy="229" r="22" fill="var(--text)" />
    </svg>
  );
}
