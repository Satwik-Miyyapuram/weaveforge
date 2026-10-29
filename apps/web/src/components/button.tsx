/**
 * The app's buttons. Each one draws a catalogue kind (states.css); a caller
 * picks the variant and size, never a class. Positioning belongs on the parent.
 */
import { Anchor } from "./anchor";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { CloseIcon, MoreIcon } from "./view-icons";

/**
 * primary: the one main action. secondary: the default. ghost: quiet chrome.
 * cancel: Cancel or Remove, red-tinted. danger: the destructive main action.
 * link: inline text.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "cancel" | "danger" | "link";
/** Default height is `--control-lg` (36 desktop, 40 phone); sm is for tables and dense toolbars. */
export type ButtonSize = "default" | "sm";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "wf-btn wf-primary",
  secondary: "wf-btn",
  ghost: "wf-btn wf-ghost",
  cancel: "wf-btn wf-danger-ghost",
  danger: "wf-btn wf-danger",
  link: "wf-link",
};

type Common = { variant?: ButtonVariant; size?: ButtonSize; children?: ReactNode };
type AsButton = Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & { href?: undefined; ref?: Ref<HTMLButtonElement> };
type AsLink = Common & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> & { href: string };

/** The app's one button. Pass `href` to get a link drawn as a button; it goes through next/link. */
export function Button(props: AsButton | AsLink) {
  const { variant = "secondary", size = "default", children, ...rest } = props;
  const cls = size === "sm" ? `${VARIANT_CLASS[variant]} wf-sm` : VARIANT_CLASS[variant];
  if (rest.href !== undefined) {
    const { href, ...attrs } = rest as AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
    return <Anchor href={href} {...attrs} className={cls}>{children}</Anchor>;
  }
  const { type = "button", ...attrs } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return <button type={type} {...attrs} className={cls}>{children}</button>;
}

type IconProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title" | "className"> & {
  /** Names the button for screen readers and the hover tip. */
  label: string;
  /** Replaces the hover text, e.g. to add the shortcut. */
  tip?: string;
  /** `danger` tints it red, for closing and removing. */
  tone?: "default" | "danger";
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
};

const ICON_CLASS = {
  default: { default: "wf-btn wf-icon", sm: "wf-btn wf-icon wf-sm" },
  danger: { default: "wf-btn wf-icon wf-danger-ghost", sm: "wf-btn wf-icon wf-danger-ghost wf-sm" },
} as const;

/** A square button with only an icon. */
export function IconButton({ label, tip, tone = "default", size = "default", type = "button", children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <button type={type} {...rest} aria-label={label} title={tip ?? label} className={ICON_CLASS[tone][size]}>
      {children}
    </button>
  );
}

/** An icon button that navigates: same look, rendered as a next/link. */
export function IconLink({ label, tip, href, tone = "default", size = "default", children }: Pick<IconProps, "label" | "tip" | "tone" | "size"> & { href: string; children: ReactNode }) {
  return (
    <Anchor href={href} aria-label={label} title={tip ?? label} className={ICON_CLASS[tone][size]}>
      {children}
    </Anchor>
  );
}

/** The one close or remove ×: a red-tinted icon button. */
export function CloseButton({ label = "Close", ...rest }: Omit<IconProps, "label" | "tone"> & { label?: string }) {
  return (
    <IconButton label={label} tone="danger" {...rest}>
      <CloseIcon />
    </IconButton>
  );
}

/** The one "more actions" button: three dots. */
export function MoreButton({ label = "More actions", ...rest }: Omit<IconProps, "label" | "tone"> & { label?: string }) {
  return (
    <IconButton label={label} {...rest}>
      <MoreIcon />
    </IconButton>
  );
}
