/**
 * Ink notes: the pen on a blank page, stored as a text layer plus binary chunks.
 *
 * The barrel is the whole public surface of the feature in core. `ink-note.ts`
 * holds the model and the folder layout, `ink-binary.ts` the container,
 * `segment.ts` the line grouping, `recognise.ts` the engine contract, and
 * `width.ts` the nib arithmetic in 0.1 mm. Nothing here imports an engine, a
 * canvas or a codec: what a runtime supplies — brotli or deflate, Windows Ink or
 * a stroke model — is injected at the call site.
 *
 * There *was* one engine here: MyScript iink, a cloud recogniser that ran only
 * when a key was pasted into Settings. It is gone, with the key field that fed
 * it. This copy recognises handwriting on the machine or not at all, which is
 * what `recognise.ts`'s engine order now describes without an exception.
 */

export {
  INK_WIDTH_UNITS_PER_MM,
  INK_PEN_WIDTHS,
  INK_PEN_WIDTH,
  INK_HIGHLIGHTER_WIDTH,
  INK_HIGHLIGHTER_MIN_WIDTH,
  INK_MIN_WIDTH,
  INK_MAX_WIDTH,
  INK_VELOCITY_FULL_TAPER,
  INK_VELOCITY_TAPER,
  INK_PRESSURE_MIN_FACTOR,
  INK_PRESSURE_MAX_FACTOR,
  clampInkNoteWidth,
  isHighlighterWidth,
  inkPressureFactor,
  inkVelocityFactor,
  nibWidth,
  inkVelocityBetween,
  strokeBaseWidth,
} from "./width.js";

export {
  INK_SMOOTH_SPACING,
  INK_SMOOTH_PASSES,
  type SmoothedInkStroke,
  resampleInkStroke,
  binomialSmooth,
  smoothInkStroke,
} from "./smooth.js";

export {
  INK_TOOLS,
  INK_COLOURS,
  INK_MARKER_COLOURS,
  INK_THEME_COLOURS,
  INK_PAPERS,
  INK_SHAPES,
  INK_HANDS,
  INK_A4_WIDTH,
  INK_A4_HEIGHT,
  INK_COORD_LIMIT,
  INK_STROKE_MAX_POINTS,
  INK_PAGE_STROKE_BUDGET,
  INK_NOTE_MAX_PAGES,
  INK_PACK_TOLERANCE,
  INK_PACK_PRESSURE_TOLERANCE,
  INK_NOTE_TYPE,
  INK_KEYS,
  INK_SIDECAR_DIR,
  INK_CHUNK_EXT,
  inkEnumIndex,
  inkEnumValue,
  makeInkStroke,
  blankInkPage,
  clampInkPageSize,
  packInkStroke,
  pressureByte,
  defaultInkNoteMeta,
  isInkNoteFrontmatter,
  readInkNoteMeta,
  writeInkNoteMeta,
  INK_BODY_HEADER,
  isInkNoteBody,
  readInkNoteBody,
  writeInkNoteBody,
  inkPageMarker,
  splitInkTextLayer,
  joinInkTextLayer,
  INK_BACKGROUND_ALT,
  inkPageBackground,
  withInkPageBackground,
  inkAttachmentIndex,
  isInkNoteId,
  isInkChunkId,
  inkSidecarDir,
  inkChunkPath,
  parseInkChunkPath,
  newInkChunkId,
  resolveInkPageOrder,
  inkPageOverBudget,
  type InkTool,
  type InkColour,
  type InkPaper,
  type InkShape,
  type InkHand,
  type InkStroke,
  type InkLineRecord,
  type InkPage,
  type InkNoteMeta,
  type PackedInkStroke,
} from "./ink-note.js";

export {
  FIGURE_ALT,
  type FigureGeometry,
  parseFigureTokens,
  formatFigureTokens,
  inkPageFigures,
  withInkPageFigures,
  figureAltFor,
  figureImageFrame,
  type FigureOrderStep,
  type FigureHandle,
  FIGURE_HANDLES,
  reorderFigures,
  resizeFigureBox,
  uncroppedFigureBox,
  cropFigureTo,
} from "./figure.js";

export {
  INK_CHUNK_MAGIC,
  INK_CHUNK_VERSION,
  INK_CHUNK_FLAG_COMPRESSED,
  INK_CHUNK_HEADER_BYTES,
  INK_CHUNK_RAW_THRESHOLD,
  INK_NOTE_MAX_BYTES,
  INK_CHUNK_MAX_POINTS,
  INK_CHUNK_MAX_STROKES,
  InkChunkError,
  identityInkChunkCodec,
  encodeInkChunkBody,
  encodeInkChunk,
  readInkChunkHeader,
  decodeInkChunkBody,
  decodeInkChunk,
  inkChunkBodySize,
  fitsInkNoteBudget,
  type InkChunkCodec,
  type InkChunkView,
  type InkChunkHeader,
} from "./ink-binary.js";

export {
  chunkStrokePoints,
  chunkAbsolutePoints,
  chunkLineText,
  chunkStroke,
  chunkLine,
  pageFromChunk,
  pageFromChunkBytes,
} from "./ink-chunk-read.js";

export {
  INK_GROUP_WINDOW_MS,
  INK_LINE_BAND_RATIO,
  inkStrokeBand,
  segmentInkLines,
  applyInkSegmentation,
  inkLineStrokes,
  type InkSegmentation,
  type RecognisedLineText,
} from "./segment.js";

export {
  INK_ENGINES,
  INK_ENGINE_ORDER,
  INK_UNSURE_CONFIDENCE,
  isInkEngineId,
  inkEngineInfo,
  selectInkRecogniser,
  isUnsureLine,
  mapInkConfidence,
  inkPageConfidence,
  inkVocabularyHints,
  type InkEngineId,
  type InkEnginePlatform,
  type InkLine,
  type RecognisedLine,
  type InkRecognitionHints,
  type InkRecogniser,
} from "./recognise.js";

export {
  INK_ENGINE_MAX_CONFIDENCE,
  decodeInkWords,
  inkVocabularyWords,
  type InkWordReadings,
} from "./decode.js";

