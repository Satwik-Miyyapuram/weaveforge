//! Experiment artifact references in report markdown for JavaScript (wf-core
//! `report::artifact_refs` and `report::artifact_markdown`). The JS names match the TS functions
//! they replace in `apps/web/src/features/report/application/`.
//!
//! The TS wrappers in `packages/wf-wasm/src/report-artifacts.ts` apply the `?? null` handling
//! and the default stale-check clock.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::report::artifact_markdown::{self, ReportExperiment};
use wf_core::report::artifact_refs::{self, ArtifactRef};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`parse_artifact_refs`](artifact_refs::parse_artifact_refs) (TS `parseArtifactRefs`). Offsets
/// are UTF-16 code units.
///
/// # Errors
///
/// Fails if the result cannot be serialised.
#[wasm_bindgen(js_name = parseArtifactRefs, unchecked_return_type = "B.ParsedArtifactRef[]")]
pub fn parse_artifact_refs_js(markdown: &str) -> JsResult<JsValue> {
    to_js(&artifact_refs::parse_artifact_refs(markdown))
}

/// [`serialise_artifact_ref`](artifact_refs::serialise_artifact_ref) (TS `serialiseArtifactRef`).
///
/// # Errors
///
/// Fails if `artifact_ref` has the wrong shape.
#[wasm_bindgen(js_name = serialiseArtifactRef)]
pub fn serialise_artifact_ref_js(
    #[wasm_bindgen(unchecked_param_type = "B.ArtifactRef")] artifact_ref: JsValue,
) -> JsResult<String> {
    let artifact_ref: ArtifactRef = serde_wasm_bindgen::from_value(artifact_ref)?;
    Ok(artifact_refs::serialise_artifact_ref(&artifact_ref))
}

/// [`artifact_basename`](artifact_refs::artifact_basename) (TS `artifactBasename`).
#[wasm_bindgen(js_name = artifactBasename)]
#[must_use]
pub fn artifact_basename_js(name: &str) -> String {
    artifact_refs::artifact_basename(name)
}

/// [`resolve_artifact_refs_markdown`](artifact_markdown::resolve_artifact_refs_markdown)
/// (TS `resolveArtifactRefsMarkdown`). `now_ms` is `Date.now()`.
///
/// # Errors
///
/// Fails if `experiments` is not a list of experiment objects.
#[wasm_bindgen(js_name = resolveArtifactRefsMarkdown)]
pub fn resolve_artifact_refs_markdown_js(
    body: &str,
    experiments: JsValue,
    now_ms: f64,
) -> JsResult<String> {
    let experiments: Vec<ReportExperiment> = serde_wasm_bindgen::from_value(experiments)?;
    Ok(artifact_markdown::resolve_artifact_refs_markdown(
        body,
        &experiments,
        now_ms,
    ))
}

/// [`safe_artifact_caption`](artifact_markdown::safe_artifact_caption) (TS `safeArtifactCaption`).
/// `undefined` or `null` counts as no caption.
#[wasm_bindgen(js_name = safeArtifactCaption)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs an owned Option<String>.
#[must_use]
pub fn safe_artifact_caption_js(alt: Option<String>) -> String {
    artifact_markdown::safe_artifact_caption(alt.as_deref())
}

/// [`safe_image_destination`](artifact_markdown::safe_image_destination) (TS `safeImageDestination`).
/// `undefined` when the URL is not allowed.
#[wasm_bindgen(js_name = safeImageDestination)]
#[must_use]
pub fn safe_image_destination_js(url: &str) -> Option<String> {
    artifact_markdown::safe_image_destination(url)
}
