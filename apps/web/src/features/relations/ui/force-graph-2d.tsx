"use client";

import type { Ref } from "react";
import ForceGraph2D from "react-force-graph-2d";

/**
 * next/dynamic wraps components in a LoadableComponent that does NOT forward
 * refs (React warns "Function components cannot be given refs"). A dropped ref
 * silently no-ops every fgRef.current call — d3Force, forceCollide, autoFit,
 * refresh — so the collision force never applies and dense nodes overlap,
 * stealing each other's clicks in the pointer buffer.
 *
 * Forwarding the handle through a plain `innerRef` prop dodges the loadable's
 * ref stripping: it arrives as an ordinary prop and we hand it straight to
 * ForceGraph2D.
 */
export default function ForceGraph2DWithRef({
  innerRef,
  ...props
}: Record<string, unknown> & { innerRef?: Ref<unknown> }) {
  // ForceGraph2D types its ref as a MutableRefObject; our handle is a subset of
  // ForceGraphMethods, so cast through unknown to satisfy the prop.
  return <ForceGraph2D ref={innerRef as never} {...props} />;
}
