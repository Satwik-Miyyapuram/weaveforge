import { Suspense } from "react";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { ReaderScreen } from "@/features/reader/ui/reader-screen";

export default function ReaderPage() {
  return (
    <Suspense
      fallback={
        <section className="screen">
          <ScreenLoader status="Loading reader…" />
        </section>
      }
    >
      <ReaderScreen />
    </Suspense>
  );
}
