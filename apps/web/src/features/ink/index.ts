/**
 * Ink notes: the pen, the page and the text layer.
 *
 * The feature's public API, and the only door into it. A feature may reach a
 * sibling only through its index (CONTRIBUTING.md § SOLID), which is why the
 * reader imports {@link InkPenGate} from here rather than from the file that
 * happens to define it: the palm rules are shared, the worker and the renderer
 * are this feature's own business.
 *
 * The host, the renderer, the stores and recognition all pass through here.
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

export {
  INK_RENDER_COLOURS,
  WebglInkRenderer,
  supportsWebglInk,
} from "./render/webgl-renderer";
export {
  CanvasInkRenderer,
  HIGHLIGHTER_ALPHA,
  PAPER_GRID_PITCH,
  PAPER_RULED_PITCH,
  cssInkColour,
  paintPaper,
  paintStroke,
  type Canvas2dLike,
  type CanvasInkRendererOptions,
  type Context2dLike,
} from "./render/canvas-renderer";

export {
  recogniseShape,
  fittedInkPath,
  fittedArrowPaths,
} from "./application/shape-snap";

export {
  InkHost,
  type InkHostDeps,
  type InkHostPage,
  type InkHostProps,
} from "./ui/ink-host";
export { fitScale, headerForTool, selectedText } from "./ui/ink-page-math";
export {
  INK_NO_ENGINE_MESSAGE,
} from "./ui/use-ink-recognition";
export { INK_SAVE_DELAY_MS } from "./ui/use-ink-note-store";
export {
  InkTextLayer,
  lineClass,
  type InkTextLayerProps,
} from "./ui/ink-text-layer";

export {
  MemoryInkChunkStore,
  chunkIdOfFileName,
  loadInkPages,
  type InkChunkStore,
  type InkStoredPage,
} from "./application/ink-chunk-store";
export { FsInkChunkStore } from "./infrastructure/fs-ink-chunk-store";
export { BlobInkChunkStore } from "./infrastructure/blob-ink-chunk-store";
export { RoutedInkChunkStore } from "./infrastructure/routed-ink-chunk-store";

export {
  INK_SYMBOL_MAP,
  VOCAB_SPAN_RATIO,
  VOCAB_WORD_DISTANCE,
  damerauLevenshtein,
  matchVocabulary,
  spanDistance,
} from "./application/vocab-match";
export {
  acceptLine,
  acceptedLines,
  assembleRecognisedPage,
  bandsCoincide,
  recognisePage,
  recognisedPageFromModel,
  type RecognisePageInput,
  type RecognisedPage,
} from "./application/recognise-page";
export {
  STROKE_CTC_ENGINE_ID,
  WINDOWS_INK_ENGINE_ID,
  createDesktopInkRecogniser,
  createOptionalMyScriptRecogniser,
  createStrokeModelRecogniser,
  desktopInkRequest,
  inkRecogniserCandidates,
} from "./application/recognisers";
export {
  InkBar,
  INK_BAR_TOOLS,
  nibForTool,
  toolLabel,
  type InkBarProps,
  type InkBarTool,
} from "./ui/ink-bar";
export { InkPage, type InkPageProps } from "./ui/ink-page";
export {
  requestInkPresenter,
  trailColour,
  trailDiameterPx,
  trailStyle,
  updateTrail,
  type InkPresenterLike,
  type InkTrailStyle,
} from "./application/ink-trail";
