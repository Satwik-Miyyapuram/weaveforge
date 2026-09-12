/**
 * Ink notes: the pen, the page and the text layer.
 *
 * The feature's public API, and the only door into it. A feature may reach a
 * sibling only through its index (CONTRIBUTING.md § SOLID), which is why the
 * reader imports {@link InkPenGate} from here rather than from the file that
 * happens to define it: the palm rules are shared, the worker and the renderer
 * are this feature's own business.
 *
 * Steps 4–9 add the host, the renderer and the tools to this barrel as they land.
 */

export {
  InkPenGate,
  contactAreaMm2,
  CSS_PX_PER_MM,
  PALM_CONTACT_AREA_MM2,
  PALM_PEN_GRACE_MS,
  PALM_SECOND_TOUCH_MS,
  TOUCH_DEFER_MS,
  TOUCH_MOVE_SLOP_PX,
  type PalmReason,
  type PenClaim,
  type PenDecision,
  type PenGateEvent,
} from "./application/pen-gate";

export {
  PenCaptureSession,
  transferMode,
  usePenCapture,
  type InkToolChoice,
  type InkWorkerLike,
  type PenCaptureDeps,
  type PenCaptureHandle,
  type PenPointerEvent,
  type UsePenCaptureOptions,
} from "./application/use-pen-capture";

export {
  NibFilter,
  OneEuroFilter,
  oneEuroAlpha,
  INK_POSITION_FILTER,
  INK_PRESSURE_FILTER,
  type FilteredNibSample,
  type NibSample,
  type OneEuroOptions,
} from "./application/one-euro-filter";

export {
  InkSamplePool,
  InkSampleWriter,
  eachInkSample,
  readInkSamples,
  INK_SAMPLE_CAPACITY,
  INK_SAMPLE_STRIDE,
  type InkSamplePayload,
  type InkStrokeHeader,
  type InkTransferMode,
  type InkViewportTransform,
  type InkWorkerEvent,
  type InkWorkerMessage,
} from "./application/capture-protocol";

export {
  InkPageBuffer,
  boundsContain,
  boundsIntersect,
  boundsOf,
  fromGeometry,
  toGeometry,
  type IncomingStroke,
  type InkBounds,
  type InkStrokeGeometry,
} from "./application/page-buffer";

export {
  ERASER_RADIUS,
  MAX_PICK_CANDIDATES,
  InkStrokeIndex,
} from "./application/stroke-index";

export {
  INK_AA_MARGIN_PX,
  INK_INSTANCE_FLOATS,
  capsuleHalfExtent,
  packStrokeInstances,
  radiusAt,
  usesHighlighterPass,
  type InkBackend,
  type InkLiveStroke,
  type InkRenderer,
  type InkRenderStats,
  type InkViewTransform,
} from "./render/ink-renderer";

export { INK_RENDER_COLOURS, WebglInkRenderer, supportsWebglInk } from "./render/webgl-renderer";

export { InkHost, fitScale, headerForTool, type InkHostPage, type InkHostProps } from "./ui/ink-host";
export { InkBar, INK_BAR_TOOLS, nibForTool, toolLabel, type InkBarProps, type InkBarTool } from "./ui/ink-bar";
export { InkPage, type InkPageProps } from "./ui/ink-page";
