/**
 * The clickable controls that are not a Button or an IconButton (design D02).
 * Each kind owns its type, role, ARIA state and its catalogue class
 * (states.css), so no screen writes a raw <button> or a button class.
 * Positioning belongs on the parent.
 */
import { Anchor } from "./anchor";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode, Ref } from "react";

import { ChevronIcon } from "./chevron-icon";
import { CloseIcon } from "./view-icons";

type Base = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "role" | "className"> & { ref?: Ref<HTMLButtonElement> };

/** A whole row or list entry that is one click target. `current` marks the open one. */
export function RowButton({ current, type = "button", ...rest }: Base & { current?: boolean }) {
  return <button type={type} aria-current={current || undefined} {...rest} className="wf-row" />;
}

/**
 * A toolbar control, such as an ink or reader tool, or a day in a calendar.
 * `label` names an icon-only tool; `tip` is the hover text (defaults to
 * `label`). Pass `pressed` to make it a toggle.
 */
export function ToolButton({
  label,
  tip,
  pressed,
  type = "button",
  ...rest
}: Omit<Base, "aria-label" | "aria-pressed" | "title"> & { label?: string; tip?: string; pressed?: boolean }) {
  return <button type={type} aria-pressed={pressed} aria-label={label} title={tip ?? label} {...rest} className="wf-tool" />;
}

const MENU_ROLE = { item: "menuitem", radio: "menuitemradio", checkbox: "menuitemcheckbox" } as const;

/** One entry in a menu. A radio or checkbox entry says whether it is checked; `danger` reds a destructive one. */
export function MenuItemButton({
  kind = "item",
  checked,
  danger = false,
  type = "button",
  ...rest
}: Omit<Base, "aria-checked"> & { kind?: keyof typeof MENU_ROLE; checked?: boolean; danger?: boolean }) {
  return (
    <button
      type={type}
      role={MENU_ROLE[kind]}
      aria-checked={kind === "item" ? undefined : !!checked}
      {...rest}
      className={danger ? "wf-item wf-danger" : "wf-item"}
    />
  );
}

/** A menu entry that goes somewhere: the same wf-item, as a link. */
export function MenuItemLink({
  href,
  danger = false,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "role"> & { href: string; danger?: boolean }) {
  return <Anchor href={href} role="menuitem" {...rest} className={danger ? "wf-item wf-danger" : "wf-item"} />;
}

/** One tab in a tab strip. For a screen's view choice use `ViewSwitch`. */
export function TabButton({ selected, type = "button", ...rest }: Omit<Base, "aria-selected"> & { selected: boolean }) {
  return <button type={type} role="tab" aria-selected={selected} {...rest} className="wf-tab" />;
}

/** The app's one on/off switch: a checkbox drawn as a track. `label` names it, since the knob has no words. */
export function Switch({
  checked,
  label,
  onChange,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role" | "checked" | "onChange" | "aria-label" | "className" | "children"> & {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      aria-label={label}
      onChange={(e) => onChange(e.currentTarget.checked)}
      {...rest}
      className="wf-toggle"
    />
  );
}

/** A colour choice. `label` names the colour for screen readers and hover; `colour` paints it. */
export function Swatch({
  label,
  selected,
  colour,
  style,
  type = "button",
  ...rest
}: Omit<Base, "aria-label" | "aria-pressed" | "title"> & {
  label: string;
  /** Pressed state of a pick; leave it out when the swatch opens a menu instead. */
  selected?: boolean;
  colour?: string;
  children?: ReactNode;
}) {
  const paint: CSSProperties | undefined = colour ? { ...style, background: colour } : style;
  return <button type={type} aria-label={label} title={label} aria-pressed={selected} style={paint} {...rest} className="wf-swatch" />;
}

/** One option of a segmented control (`.wf-seg`): stays pressed or not. */
export function ToggleButton({ pressed, type = "button", ...rest }: Omit<Base, "aria-pressed"> & { pressed: boolean }) {
  return <button type={type} aria-pressed={pressed} {...rest} />;
}

/** One row of a listbox, such as a select's or quick-open's results. */
export function OptionButton({ selected, type = "button", ...rest }: Omit<Base, "aria-selected"> & { selected: boolean }) {
  return <button type={type} role="option" aria-selected={selected} {...rest} className="wf-item" />;
}

/** One choice of a radiogroup, drawn as a segment of `.wf-seg`. */
export function RadioButton({ checked, type = "button", ...rest }: Omit<Base, "aria-checked"> & { checked: boolean }) {
  return <button type={type} role="radio" aria-checked={checked} {...rest} />;
}

/** The trigger that opens a listbox, such as the custom select. `aria-controls` names the open listbox. */
export function ComboboxButton({
  expanded,
  "aria-controls": controls,
  type = "button",
  ...rest
}: Omit<Base, "aria-expanded"> & { expanded: boolean }) {
  return <button type={type} role="combobox" aria-expanded={expanded} aria-controls={controls} {...rest} className="wf-select" />;
}

type ChipProps = {
  children: ReactNode;
  /** Adds the red × that removes the chip; `removeLabel` names it. */
  onRemove?: () => void;
  removeLabel?: string;
  title?: string;
};

/**
 * A small pill: a tag, a filter, a branch. Plain by default; `onClick` makes it
 * a button (with `pressed` for an on/off filter); `href` makes it a link.
 */
export function Chip(
  props: ChipProps &
    (
      | { href?: undefined; onClick?: undefined; pressed?: undefined }
      | ({ href?: undefined; onClick: () => void; pressed?: boolean; disabled?: boolean } & Pick<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">)
      | ({ href: string; onClick?: undefined; pressed?: undefined } & Pick<AnchorHTMLAttributes<HTMLAnchorElement>, "target" | "rel" | "aria-label">)
    ),
) {
  const { children, onRemove, removeLabel = "Remove", title } = props;
  const x = onRemove ? (
    <button type="button" className="wf-chip-x" aria-label={removeLabel} title={removeLabel} onClick={onRemove}>
      <CloseIcon size={12} />
    </button>
  ) : null;
  if (props.href !== undefined) {
    return (
      <Anchor href={props.href} target={props.target} rel={props.rel} aria-label={props["aria-label"]} title={title} className="wf-chip">
        {children}
      </Anchor>
    );
  }
  if (props.onClick) {
    return (
      <button type="button" aria-pressed={props.pressed} aria-label={props["aria-label"]} title={title} disabled={props.disabled} onClick={props.onClick} className="wf-chip">
        {children}
      </button>
    );
  }
  return (
    <span title={title} className="wf-chip">
      {children}
      {x}
    </span>
  );
}

/** A section heading that folds its section. `count` shows on the right. */
export function FoldButton({
  expanded,
  count,
  children,
  type = "button",
  ...rest
}: Omit<Base, "aria-expanded"> & { expanded: boolean; count?: ReactNode }) {
  return (
    <button type={type} aria-expanded={expanded} {...rest} className="wf-fold">
      <ChevronIcon />
      {children}
      {count != null && <span className="wf-fold-count">{count}</span>}
    </button>
  );
}

/** A link in the app's navigation. `current` marks the page you are on. */
export function NavLink({
  href,
  current,
  children,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "aria-current"> & { href: string; current?: boolean }) {
  return (
    <Anchor href={href} aria-current={current ? "page" : undefined} {...rest} className="wf-nav">
      {children}
    </Anchor>
  );
}

/** A nav entry that acts rather than goes, such as Search: the same wf-nav, as a button. */
export function NavButton({ type = "button", ...rest }: Base) {
  return <button type={type} {...rest} className="wf-nav" />;
}
