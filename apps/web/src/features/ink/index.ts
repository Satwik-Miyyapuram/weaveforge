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
  PenCaptureSession,
  transferMode,
  usePenCapture,
  type InkToolChoice,
  type InkWorkerLike,
  type PenCaptureDeps,
  type PenCaptureHandle,
  type PenClaim,
  type PenDecision,
  type PalmReason,
  type PenGateEvent,
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
