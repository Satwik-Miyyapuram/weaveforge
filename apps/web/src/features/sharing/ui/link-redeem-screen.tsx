"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getContainer } from "@/bootstrap";
import { sharedResourceHref } from "./shared-item-routes.js";
import { formatError } from "@/lib/format-error";

export function LinkRedeemScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const token = params.get("t");
  const redeemStarted = useRef(false);

  useEffect(() => {
    if (!token || redeemStarted.current) return;
    redeemStarted.current = true;
    setRedeeming(true);

    // Deliberately not cancelled on cleanup. A redemption runs once per token —
    // the ref guarantees that — so an effect that re-ran because `router`
    // changed identity mid-flight used to abandon the only attempt there would
    // ever be, and the screen sat on "Opening shared item…" forever.
    void (async () => {
      try {
        const resolved = await getContainer().sharing.redeemShareLink(token);
        router.replace(sharedResourceHref(resolved.resourceType, resolved.resourceId));
      } catch (e) {
        setError(formatError(e));
        setRedeeming(false);
      }
    })();
  }, [token, router]);

  if (!token) {
    return (
      <main className="app-shell link-redeem-screen" data-testid="link-redeem">
        <p className="error">Missing link token.</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="app-shell link-redeem-screen" data-testid="link-redeem">
        <p className="error">{error}</p>
      </main>
    );
  }

  return (
    <main className="app-shell link-redeem-screen" data-testid="link-redeem">
      <p className="muted">
        {redeeming ? "Opening shared item…" : "Preparing shared link…"}
      </p>
    </main>
  );
}
