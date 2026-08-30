"use client";

import {
  PRIVACY_DISCLAIMER_PARAGRAPHS,
  PRIVACY_DISCLAIMER_TITLE,
  PRIVACY_LOCAL_PARAGRAPHS,
  PRIVACY_LOCAL_TITLE,
} from "@/features/legal/privacy-disclaimer";
import { useCapability } from "@/deployment/capabilities";

/**
 * Read-only privacy disclaimer (settings footer).
 *
 * Which one depends on whether there is anybody but the reader who could read
 * the data. A copy with no account is not a copy with fewer privacy concerns —
 * it has different ones, and they are the ones printed here.
 */
export function PrivacyNotice() {
  const disclosable = useCapability("operatorDisclosure");
  const title = disclosable ? PRIVACY_DISCLAIMER_TITLE : PRIVACY_LOCAL_TITLE;
  const paragraphs = disclosable ? PRIVACY_DISCLAIMER_PARAGRAPHS : PRIVACY_LOCAL_PARAGRAPHS;

  return (
    <div className="card add-form privacy-notice">
      <h3 className="settings-group">{title}</h3>
      {paragraphs.map((p) => (
        <p key={p} className="muted privacy-notice__p">
          {p}
        </p>
      ))}
    </div>
  );
}
