import { Suspense } from "react";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { ExperimentDetailScreen } from "@/features/experiments/ui/experiment-detail-screen";

export default async function ExperimentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense
      fallback={
        <section className="screen">
          <ScreenLoader status="Loading experiment…" />
        </section>
      }
    >
      <ExperimentDetailScreen id={id} />
    </Suspense>
  );
}
