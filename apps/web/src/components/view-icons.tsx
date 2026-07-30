import type { ReactNode } from "react";

/** Compact stroke icons for layout toggles, filters, and card actions. */

type IconProps = { size?: number; className?: string; title?: string };

/**
 * Icon dimensions come from the `--icon-size` CSS token (see globals.css) via
 * the `.vicon` class — one place controls every icon. Pass `size` only to
 * deliberately override a single icon.
 */
function Svg({
  size,
  className,
  title,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={size != null ? { width: size, height: size } : undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `vicon ${className}` : "vicon"}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** Masonry / card grid. */
export function CardsViewIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Svg>
  );
}

/** Vertical list rows. */
export function ListViewIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </Svg>
  );
}

/** Status board / kanban columns. */
export function BoardViewIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="10" rx="1.5" />
      <rect x="17" y="4" width="5" height="13" rx="1.5" />
    </Svg>
  );
}

/** Side-by-side compare / table. */
export function CompareViewIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h4v12H4zM10 10h4v8h-4zM16 4h4v14h-4z" />
    </Svg>
  );
}

/** Funnel for filters. */
export function FilterIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5h16l-6 7v5l-4 2v-7L4 5z" />
    </Svg>
  );
}

/** Open / go-to detail (arrow into box). */
export function OpenIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 3h7v7" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </Svg>
  );
}

/** Trash — delete entity. */
export function DeleteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  );
}

/** Share nodes. */
export function ShareIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.59 13.51 15.42 17.49M15.41 6.51 8.59 10.49" />
    </Svg>
  );
}

/** Speech bubble — comments. */
export function CommentsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Svg>
  );
}

/** Pencil — edit. */
export function EditIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  );
}

/** Line chart — experiment curves. */
export function CurvesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 4 3 5-6" />
    </Svg>
  );
}

/** Bookmark — add to library. */
export function BookmarkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </Svg>
  );
}

/** Bell — tracked alerts / notifications. */
export function BellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </Svg>
  );
}

/**
 * Struck-through bell — alerts are unavailable, as opposed to available but
 * switched off. The plain bell alone could not tell those two apart.
 */
export function BellOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
      <path d="M3 3l18 18" />
    </Svg>
  );
}

/** Document + plus — duplicate into my library (not clipboard). */
export function DuplicateIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M12 18v-6M9 15h6" />
    </Svg>
  );
}

/** Gear — settings / preferences. */
export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </Svg>
  );
}

/** Sun — graph view controls. */
export function SunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Svg>
  );
}

/** Landscape image — attach image. */
export function ImageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15 16 10 5 21" />
    </Svg>
  );
}

/** Unlink — remove from list (not delete entity). */
export function UnlinkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18.84 12.25 21.06 10a3.5 3.5 0 0 0-5-5l-2.25 2.22" />
      <path d="M5.16 11.75 2.94 14a3.5 3.5 0 0 0 5 5l2.25-2.22" />
      <path d="M8 8 16 16" />
    </Svg>
  );
}
