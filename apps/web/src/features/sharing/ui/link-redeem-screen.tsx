"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getContainer } from "@/bootstrap";
import { sharedResourceHref } from "./shared-item-routes.js";
import { formatError } from "@/lib/format-error";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { NavIcon } from "@/app/nav-icon";
import { ScreenLoading } from "@/components/screen-loading";

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

  if (!token || error) {
    return (
      <main className="app-shell link-redeem-screen" data-testid="link-redeem">
        <EmptyState
          variant="first-run"
          icon={<NavIcon name="share" />}
          title={token ? "This link didn't open" : "This link is incomplete"}
          body={
            error ??
            "A shared link ends in a code that opens the item. Ask the person who shared it for the full link."
          }
          action={<Button href="/">Go home</Button>}
        />
      </main>
    );
  }

  return (
    <main className="app-shell link-redeem-screen" data-testid="link-redeem">
      <ScreenLoading status={redeeming ? "Opening shared item…" : "Preparing shared link…"} />
    </main>
  );
}
