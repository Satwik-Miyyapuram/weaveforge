import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from "react";

/** The button roles. Danger is the destructive primary; link reads as inline text; see buttons.css. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
/** Default height is `--control-lg` (36 desktop, 40 phone); sm is for tables and dense toolbars. */
export type ButtonSize = "default" | "sm";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-primary btn-danger",
  link: "link-btn",
};

type Common = { variant?: ButtonVariant; size?: ButtonSize; className?: string; children?: ReactNode };
type AsButton = Common & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined; ref?: Ref<HTMLButtonElement> };
type AsLink = Common & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

function classes({ variant = "secondary", size = "default", className }: Common): string {
  return [VARIANT_CLASS[variant], size === "sm" ? "btn-sm" : "", className ?? ""].filter(Boolean).join(" ");
}

/** The app's one button. Pass `href` to get a link styled as a button; it goes through next/link. */
export function Button(props: AsButton | AsLink) {
  const { variant, size, className, children, ...rest } = props;
  const cls = classes({ variant, size, className });
  if (rest.href !== undefined) {
    const { href, ...attrs } = rest as AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
    return <Link href={href} {...attrs} className={cls}>{children}</Link>;
  }
  const { type = "button", ...attrs } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return <button type={type} {...attrs} className={cls}>{children}</button>;
}

/**
 * A square button with only an icon. `label` names it for screen readers and the
 * hover tip; `tip` replaces the hover text, e.g. to add the shortcut.
 */
export function IconButton({
  label,
  tip,
  className,
  children,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & { label: string; tip?: string; children: ReactNode }) {
  return (
    <button type={type} {...rest} aria-label={label} title={tip ?? label} className={className ? `icon-btn ${className}` : "icon-btn"}>
      {children}
    </button>
  );
}
