"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getContainer } from "@/bootstrap";
import { sharedResourceHref } from "./shared-item-routes.js";

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof (e as { message: unknown }).message === "string"
  ) {
    return (e as { message: string }).message;
  }
  return String(e);
}

export function LinkRedeemScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const unlocked = true;
  const token = params.get("t");
  const redeemStarted = useRef(false);

  useEffect(() => {
    if (!token || !unlocked || redeemStarted.current) return;
    redeemStarted.current = true;
    let alive = true;
    setRedeeming(true);

    void (async () => {
      try {
        const resolved = await getContainer().sharing.redeemShareLink(token);
        if (!alive) return;
        router.replace(sharedResourceHref(resolved.resourceType, resolved.resourceId));
      } catch (e) {
        if (!alive) return;
        setError(errorMessage(e));
        setRedeeming(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [token, unlocked, router]);

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
        {!unlocked
          ? "Unlock encryption to open this shared link…"
          : redeeming
            ? "Opening shared item…"
            : "Preparing shared link…"}
      </p>
    </main>
  );
}
