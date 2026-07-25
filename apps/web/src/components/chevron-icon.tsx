/** Shared chevron used by popovers, selects, and expand toggles. */
export function ChevronIcon({
  open = false,
  variant = "flip",
  size = 16,
  className = "",
}: {
  open?: boolean;
  /** `flip` = down/up (popovers). `expand` = right/down (tree rows). */
  variant?: "flip" | "expand";
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`chev chev-${variant}${open ? " open" : ""}${className ? ` ${className}` : ""}`}
      aria-hidden
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </span>
  );
}
