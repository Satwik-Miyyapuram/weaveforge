import { Suspense } from "react";
import { ScreenLoader } from "@/components/thesis-loader";
import { ExperimentDetailScreen } from "@/features/experiments/ui/experiment-detail-screen";

export default function ExperimentDetailPage({ params }: { params: { id: string } }) {
  return (
    <Suspense
      fallback={
        <section className="screen">
          <ScreenLoader status="Loading experiment…" />
        </section>
      }
    >
      <ExperimentDetailScreen id={params.id} />
    </Suspense>
  );
}
