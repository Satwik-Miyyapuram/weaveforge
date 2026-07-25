import { Suspense } from "react";
import { LinkRedeemScreen } from "@/features/sharing/ui/link-redeem-screen";

export default function LinkPage() {
  return (
    <Suspense fallback={null}>
      <LinkRedeemScreen />
    </Suspense>
  );
}
