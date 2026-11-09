import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Functions the web calls through the Rust core (`readyCore()` / `loadCore()`).
// Importing their TypeScript twins from @weaveforge/core would quietly bring
// the old copy back, so app code must not.
const RUST_OWNED = [
  "addCounts",
  "agreementBetween",
  "analyzePdfDocument",
  "AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS",
  "AI_PROPOSAL_KINDS",
  "AI_READ_CATEGORIES",
  "applyCommaPlacement",
  "applyInkSegmentation",
  "applyUserIntegrationFields",
  "bodyLinksTo",
  "buildUrlCleanupOptions",
  "buildWikiIndex",
  "canJoinInkGroup",
  "cardSnippet",
  "changedSide",
  "checkBibliography",
  "chooseAnchorStrategy",
  "clampInkWidth",
  "clampInkZoom",
  "clampPage",
  "clampScale",
  "clampZoomFactor",
  "cleanPastedText",
  "cleanPdfText",
  "cleanUrlsInText",
  "cleanWrappedText",
  "commandMatchIndices",
  "compactInkPath",
  "computeFitPageScale",
  "computeFitWidthScale",
  "countJsonActions",
  "decodeInkWords",
  "decodeLocus",
  "DEFAULT_PASTE_SETTINGS",
  "DEPENDENCY_KINDS",
  "describeChanges",
  "diffJsonData",
  "diffWorkspace",
  "effectiveRelationTypes",
  "EMPTY_INK_UNDO",
  "encodeLocus",
  "entityDir",
  "experimentActivityAt",
  "explainArm",
  "extractWikilinks",
  "findDocumentMatches",
  "formatMetricValue",
  "graphFilterCount",
  "groupPaletteRows",
  "imageAltFromFilename",
  "imageExtensionForMime",
  "imagePathsInBody",
  "initialReaderViewport",
  "inkNoteWidthToPdfPoints",
  "inkPageConfidence",
  "inkPathsHitTest",
  "inkPathsInPolygon",
  "inkVocabularyHints",
  "inkZoomIn",
  "inkZoomOut",
  "invalidationMap",
  "invalidationPlan",
  "isAppOwnedPath",
  "isBibliographicMatch",
  "isHighlighterInk",
  "isKnownResourceType",
  "isPreviewKey",
  "isRotatedText",
  "isUnsureLine",
  "isUserIntegrationConnected",
  "itemToRect",
  "jsonDataPath",
  "jsonKindOfPath",
  "LOG_KINDS",
  "mapInkConfidence",
  "markdownImage",
  "markdownToLatex",
  "matchingPageIndices",
  "MAX_FIELD_WEIGHT",
  "mentionRects",
  "mergeWikiPages",
  "MIN_FIELD_WEIGHT",
  "mirrorWorkspace",
  "nextMatchIndex",
  "nextRotation",
  "normalizeMarkdownImageSyntax",
  "normalizePasteSettings",
  "outlineFromText",
  "outlineItemOf",
  "assemblePageCitations",
  "coalesceMentions",
  "detectCitationStyle",
  "findFigureMentions",
  "findHeadingLines",
  "findReferenceSection",
  "furnitureLines",
  "headingOutline",
  "isCitationDestination",
  "ladderOrder",
  "matchPageCitations",
  "nativeCitationMentions",
  "pageTextFromItems",
  "paletteModeFor",
  "parseBibEntries",
  "parseJsonData",
  "parseLinkRemovalText",
  "parseMdImageAlt",
  "parseThemeConfig",
  "parseWorkspaceFolder",
  "pasteLandsInVerbatimContext",
  "pdfPointToScreen",
  "pdfRectToScreenBox",
  "prismaCaveat",
  "prismaFigureTex",
  "projectDir",
  "pushInkUndo",
  "readableText",
  "readerKeyboardCommand",
  "refreshInkUndoAnnotation",
  "RELATION_TYPES",
  "renameInkUndoId",
  "replaceWikiIndex",
  "resolveTextAnchor",
  "screenPointToPdf",
  "segmentInkLines",
  "selectionToAnchor",
  "serializeWorkspace",
  "setImagePlacement",
  "shortSha",
  "shouldAppendInkPoint",
  "showConceptEdges",
  "showRelationEdges",
  "sortHitOrder",
  "stripFrontmatter",
  "tabSeparatedToMarkdownTable",
  "takeInkRedo",
  "takeInkUndo",
  "themeConfigTemplate",
  "toRelativeBlobLinks",
  "toZoteroWritePayload",
  "translateInkPaths",
  "uniqueCiteKey",
  "uniqueTitle",
  "VAULT_IMAGE_PREFIX",
  "vaultImageMarkdown",
  "verdictFor",
  "withImageWidth",
  "withMdImageAlt",
  "workspaceSnapshotCounts",
  "zoomIn",
  "zoomOut",
  "zoteroWriteBackAnnotations",
];

const src = fileURLToPath(new URL("../../", import.meta.url));

function appFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : appFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const CORE = String.raw`["']@weaveforge\/core(?:\/[^"']*)?["']`;

/** Bare names in an import or destructuring list: `a`, `b as c` and `b: c` all give the first name. */
function listNames(list: string): string[] {
  return list
    .split(",")
    .map((part) => part.trim())
    .filter((spec) => spec && !spec.startsWith("type "))
    .map((spec) => (spec.split(/\s+as\s+|\s*:\s*/).at(0) ?? "").trim());
}

/**
 * Names a file takes from @weaveforge/core (or a subpath), without `type` imports:
 * named imports and re-exports, destructured dynamic imports, and `ns.name` on a
 * namespace import.
 */
function coreImports(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(new RegExp(String.raw`(?:import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*${CORE}`, "g"))) {
    if (!m[1]) names.push(...listNames(m[2] ?? ""));
  }
  for (const m of text.matchAll(new RegExp(String.raw`\{([^}]*)\}\s*=\s*await\s+import\(\s*${CORE}\s*\)`, "g"))) {
    names.push(...listNames(m[1] ?? ""));
  }
  for (const m of text.matchAll(new RegExp(String.raw`import\s+\*\s+as\s+(\w+)\s+from\s*${CORE}`, "g"))) {
    for (const use of text.matchAll(new RegExp(String.raw`\b${m[1]}\.(\w+)`, "g"))) names.push(use[1] ?? "");
  }
  return names;
}

test("coreImports reads value names and skips type imports", () => {
  const text = `import { a, type B, c as d } from "@weaveforge/core";\nimport type { E } from "@weaveforge/core";\nexport { f } from '@weaveforge/core';`;
  assert.deepEqual(coreImports(text), ["a", "c", "f"]);
});

test("coreImports reads subpaths, dynamic imports and namespace uses", () => {
  const text = [
    `import { g } from "@weaveforge/core/reader-analysis";`,
    `const { h, i: j } = await import("@weaveforge/core");`,
    `import * as wf from "@weaveforge/core";`,
    `wf.k(wf.l);`,
  ].join("\n");
  assert.deepEqual(coreImports(text), ["g", "h", "i", "k", "l"]);
});

test("app code takes Rust-owned functions from the Rust core, not @weaveforge/core", () => {
  const offenders = appFiles(src).flatMap((file) =>
    coreImports(readFileSync(file, "utf8"))
      .filter((name) => RUST_OWNED.includes(name))
      .map((name) => `${file.slice(src.length)}: ${name}`),
  );
  assert.deepEqual(offenders, []);
});
