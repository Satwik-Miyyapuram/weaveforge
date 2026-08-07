import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GENERATED_ROUTE_COMPONENTS } from "@/deployment/generated-routes";

/** Render only a route selected by the compile-time deployment registry. */
export function renderGeneratedRoute(path: string) {
  const Component = GENERATED_ROUTE_COMPONENTS[path as keyof typeof GENERATED_ROUTE_COMPONENTS];
  if (!Component) notFound();
  const Screen = Component as React.ComponentType;
  return <Suspense fallback={null}><Screen /></Suspense>;
}
