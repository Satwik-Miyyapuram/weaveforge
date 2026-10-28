/**
 * The clickable controls that are not a Button or an IconButton (design D02).
 * Each kind owns its type, role and ARIA state, so no screen writes a raw
 * <button>. The look stays with the caller's class; these fix the behaviour.
 */
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

type Base = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "role"> & { ref?: Ref<HTMLButtonElement> };

/** A whole row, card or list entry that is one click target. `current` marks the open one. */
export function RowButton({ current, type = "button", ...rest }: Base & { current?: boolean }) {
  return <button type={type} aria-current={current || undefined} {...rest} />;
}

/**
 * A toolbar control, such as an ink or reader tool. `label` names an icon-only
 * tool; `tip` is the hover text (defaults to `label`). Pass `pressed` to make it
 * a toggle.
 */
export function ToolButton({
  label,
  tip,
  pressed,
  className,
  type = "button",
  ...rest
}: Omit<Base, "aria-label" | "aria-pressed" | "title"> & { label?: string; tip?: string; pressed?: boolean }) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      aria-label={label}
      title={tip ?? label}
      {...rest}
      className={className ? `ink-tool ${className}` : "ink-tool"}
    />
  );
}

const MENU_ROLE = { item: "menuitem", radio: "menuitemradio", checkbox: "menuitemcheckbox" } as const;

/** One entry in a menu. A radio or checkbox entry says whether it is checked. */
export function MenuItemButton({
  kind = "item",
  checked,
  type = "button",
  ...rest
}: Omit<Base, "aria-checked"> & { kind?: keyof typeof MENU_ROLE; checked?: boolean }) {
  return <button type={type} role={MENU_ROLE[kind]} aria-checked={kind === "item" ? undefined : !!checked} {...rest} />;
}

/** One tab in a tab strip. For a screen's view choice use `ViewSwitch`. */
export function TabButton({ selected, type = "button", ...rest }: Omit<Base, "aria-selected"> & { selected: boolean }) {
  return <button type={type} role="tab" aria-selected={selected} {...rest} />;
}

/** The app's one on/off switch. `label` names it, since the knob has no words. */
export function Switch({
  checked,
  label,
  className,
  type = "button",
  ...rest
}: Omit<Base, "aria-checked" | "aria-label" | "children"> & { checked: boolean; label: string }) {
  const cls = ["toggle", checked ? "on" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button type={type} role="switch" aria-checked={checked} aria-label={label} {...rest} className={cls}>
      <span className="knob" />
    </button>
  );
}

/** A colour choice. `label` names the colour for screen readers and hover. */
export function Swatch({
  label,
  selected,
  type = "button",
  ...rest
}: Omit<Base, "aria-label" | "aria-pressed" | "title"> & { label: string; selected: boolean; children?: ReactNode }) {
  return <button type={type} aria-label={label} title={label} aria-pressed={selected} {...rest} />;
}

/** A button that stays pressed or not, such as a filter chip. */
export function ToggleButton({ pressed, type = "button", ...rest }: Omit<Base, "aria-pressed"> & { pressed: boolean }) {
  return <button type={type} aria-pressed={pressed} {...rest} />;
}

/** One row of a listbox, such as a select's or quick-open's results. */
export function OptionButton({ selected, type = "button", ...rest }: Omit<Base, "aria-selected"> & { selected: boolean }) {
  return <button type={type} role="option" aria-selected={selected} {...rest} />;
}

/** One choice of a radiogroup. */
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
  return <button type={type} role="combobox" aria-expanded={expanded} aria-controls={controls} {...rest} />;
}
