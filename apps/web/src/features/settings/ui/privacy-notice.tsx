import {
  PRIVACY_DISCLAIMER_PARAGRAPHS,
  PRIVACY_DISCLAIMER_TITLE,
} from "@/features/legal/privacy-disclaimer";

/** Read-only privacy disclaimer (settings footer). */
export function PrivacyNotice() {
  return (
    <div className="card add-form privacy-notice">
      <h3 className="settings-group">{PRIVACY_DISCLAIMER_TITLE}</h3>
      {PRIVACY_DISCLAIMER_PARAGRAPHS.map((p) => (
        <p key={p} className="muted privacy-notice__p">
          {p}
        </p>
      ))}
    </div>
  );
}
