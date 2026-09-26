import { CARD_TINT_OPTIONS, type CardTint } from "@/lib/theme/theme";

/**
 * How reading status colours a paper card, each choice drawn as a small card
 * so the picker previews what it does. Poster and CRT only.
 */
export function CardTintPicker({ value: cardTint, onChange }: { value: CardTint; onChange: (id: CardTint) => void }) {
  return (
    <div className="appearance-row appearance-row--stack">
      <div className="appearance-row-text">
        <span className="appearance-label" id="cardTint">
          Card tint <span className="appearance-tag">Poster and CRT</span>
        </span>
        <p>How reading status colours a paper card. Only shown for the Poster and CRT themes.</p>
      </div>
      <span />
      <div className="tint-picker" role="radiogroup" aria-labelledby="cardTint">
        {CARD_TINT_OPTIONS.map((opt) => (
          <label key={opt.id} className={`tint-option tint-option--${opt.id}${cardTint === opt.id ? " is-on" : ""}`}>
            <span className="tint-sample" aria-hidden>
              <span className="tint-sample-card">
                {opt.id === "bar" && <span className="tint-sample-band" />}
                <span className="tint-sample-body">
                  <strong>Locating and editing factual associations</strong>
                  <span className="tint-sample-meta">Meng et al. · 2022</span>
                  {opt.id === "none" && <span className="tint-sample-chip">Reading</span>}
                </span>
              </span>
            </span>
            <span className="tint-option-foot">
              <input
                type="radio"
                name="cardTint"
                value={opt.id}
                checked={cardTint === opt.id}
                onChange={() => onChange(opt.id)}
              />
              <span className="tint-option-text">
                <span className="tint-option-name">{opt.label}</span>
                <span className="tint-option-note">{opt.note}</span>
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
