import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

/** The four button roles. Danger is the destructive primary; see buttons.css. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
/** Default height is `--control-lg` (36 desktop, 40 phone); sm is for tables and dense toolbars. */
export type ButtonSize = "default" | "sm";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-primary btn-danger",
};

type Common = { variant?: ButtonVariant; size?: ButtonSize; className?: string; children?: ReactNode };
type AsButton = Common & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type AsLink = Common & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

function classes({ variant = "secondary", size = "default", className }: Common): string {
  return [VARIANT_CLASS[variant], size === "sm" ? "btn-sm" : "", className ?? ""].filter(Boolean).join(" ");
}

/** The app's one button. Pass `href` to get a link styled as a button. */
export function Button(props: AsButton | AsLink) {
  const { variant, size, className, children, ...rest } = props;
  const cls = classes({ variant, size, className });
  if (rest.href !== undefined) {
    return <a {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} className={cls}>{children}</a>;
  }
  const { type = "button", ...attrs } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return <button type={type} {...attrs} className={cls}>{children}</button>;
}

/** A square button with only an icon. `label` names it for screen readers and the hover tip. */
export function IconButton({
  label,
  className,
  children,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & { label: string; children: ReactNode }) {
  return (
    <button type={type} {...rest} aria-label={label} title={label} className={className ? `icon-btn ${className}` : "icon-btn"}>
      {children}
    </button>
  );
}
