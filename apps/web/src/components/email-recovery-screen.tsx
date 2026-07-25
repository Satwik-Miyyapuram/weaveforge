"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy /recover route. Email recovery existed only for client E2EE, which has
 * been dropped — there is nothing to unlock, so this route just bounces to the
 * app.
 */
export function EmailRecoveryScreen() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);
  return null;
}
