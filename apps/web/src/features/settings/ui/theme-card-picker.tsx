"use client";

/** How many options get a full preview card; the rest are chips below. */
const CARD_COUNT = 4;

/**
 * Pick a theme by what it looks like. Each card previews the real palette:
 * the theme files key their colours off `[data-theme]` on any element, so a
 * preview tagged with the theme id reads that theme's tokens without applying
 * it to the page.
 */
export function ThemeCardPicker({
  name,
  labelledBy,
  options,
  value,
  onChange,
}: {
  name: string;
  labelledBy: string;
  options: ReadonlyArray<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  const cards = options.slice(0, CARD_COUNT);
  const chips = options.slice(CARD_COUNT);
  const radio = (id: string) => (
    <input
      type="radio"
      className="themed-check"
      name={name}
      value={id}
      checked={value === id}
      onChange={() => onChange(id)}
    />
  );
  return (
    <div className="theme-picker" role="radiogroup" aria-labelledby={labelledBy}>
      <div className="theme-cards">
        {cards.map((opt) => (
          <label key={opt.id} className={`theme-card${value === opt.id ? " is-on" : ""}`}>
            <span className="theme-card-preview" data-theme={opt.id} aria-hidden>
              <span className="theme-card-bar" />
              <span className="theme-card-block theme-card-block--a" />
              <span className="theme-card-block theme-card-block--b" />
            </span>
            <span className="theme-card-foot">
              {radio(opt.id)}
              {opt.label}
            </span>
          </label>
        ))}
      </div>
      {chips.length > 0 && (
        <div className="theme-chips">
          <span className="muted theme-chips-label">More themes</span>
          {chips.map((opt) => (
            <label key={opt.id} className={`theme-chip${value === opt.id ? " is-on" : ""}`}>
              {radio(opt.id)}
              <span className="theme-chip-dot" data-theme={opt.id} aria-hidden />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
