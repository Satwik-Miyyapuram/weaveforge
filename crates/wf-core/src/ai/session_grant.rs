//! Pure rules for starting an AI session grant (TS `create-ai-session-grant.use-case.ts`).
//!
//! The grant lives only in browser memory; this module builds the value and does no storage.

use super::access_policy::{
    AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS, AiAccessSettings, AiProposalKind, AiToolName,
    AiWorkspaceSource, ai_read_category_for_resource,
};
use crate::sync::instant::{format_instant, parse_instant};

/// Default grant lifetime: 30 minutes (TS `AI_SESSION_DEFAULT_TTL_MS`).
pub const AI_SESSION_DEFAULT_TTL_MS: i64 = 30 * 60 * 1000;
/// Longest grant lifetime: 7 days (TS `AI_SESSION_MAX_TTL_MS`).
pub const AI_SESSION_MAX_TTL_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// Inputs to start a session (TS `CreateAiSessionGrantInput`).
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SessionGrantInput {
    /// Id shared by the workspace and the grant.
    pub id: String,
    /// Display name; trimmed, required.
    pub workspace_name: String,
    /// Resources to read; de-duplicated, empty ids dropped.
    pub sources: Vec<AiWorkspaceSource>,
    /// Current settings.
    pub settings: AiAccessSettings,
    /// Whether the encryption key is unlocked.
    pub encryption_unlocked: bool,
    /// Session start, ISO 8601.
    pub now: String,
    /// Requested lifetime in ms; absent or non-finite uses the default.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub ttl_ms: Option<f64>,
    /// Tools the grant allows.
    pub allowed_tools: Vec<AiToolName>,
    /// Proposal kinds requested; kept only when enabled in settings and not credential-protected.
    pub proposal_capabilities: Vec<AiProposalKind>,
}

/// The workspace a session starts with (TS `AiWorkspace`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SessionWorkspace {
    /// Workspace id.
    pub id: String,
    /// Trimmed display name.
    pub name: String,
    /// Sources the workspace reads.
    pub sources: Vec<AiWorkspaceSource>,
    /// Start time, ISO 8601.
    pub created_at: String,
    /// Start time, ISO 8601.
    pub updated_at: String,
}

/// The grant a session starts with (TS `AiSessionGrant` plus `requiresConfirmationForWrites`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SessionGrant {
    /// Grant id.
    pub id: String,
    /// Workspace id.
    pub workspace_id: String,
    /// Expiry, ISO 8601.
    pub expires_at: String,
    /// Resources the grant can read.
    pub readable: Vec<AiWorkspaceSource>,
    /// Tools the grant allows; de-duplicated, first occurrence kept.
    pub allowed_tools: Vec<AiToolName>,
    /// Proposal kinds the grant allows; de-duplicated, first occurrence kept.
    pub proposal_capabilities: Vec<AiProposalKind>,
    /// Always true: writes need confirmation.
    pub requires_confirmation_for_writes: bool,
}

/// A started session (TS `AiActiveSession`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ActiveSession {
    /// The workspace.
    pub workspace: SessionWorkspace,
    /// The grant.
    pub grant: SessionGrant,
    /// Start time, ISO 8601.
    pub started_at: String,
}

/// Clamp a requested lifetime to whole ms in `[1, AI_SESSION_MAX_TTL_MS]`.
///
/// `None` and non-finite values use the default (TS `clampTtl` with `?? DEFAULT`).
#[must_use]
pub fn clamp_session_ttl_ms(ttl_ms: Option<f64>) -> i64 {
    match ttl_ms {
        Some(ms) if ms.is_finite() => {
            let floored = ms.floor();
            let capped = floored.min(AI_SESSION_MAX_TTL_MS as f64);
            capped.max(1.0) as i64
        }
        _ => AI_SESSION_DEFAULT_TTL_MS,
    }
}

/// Drop sources with an empty resource id and repeats of `resourceType:resourceId`.
#[must_use]
pub fn unique_session_sources(sources: &[AiWorkspaceSource]) -> Vec<AiWorkspaceSource> {
    let mut seen: Vec<(super::access_policy::AiResourceType, &str)> = Vec::new();
    let mut kept = Vec::new();
    for source in sources {
        if source.resource_id.is_empty() {
            continue;
        }
        let key = (source.resource_type, source.resource_id.as_str());
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        kept.push(source.clone());
    }
    kept
}

/// Keep the first occurrence of each value, in order (TS `[...new Set(xs)]`).
fn dedupe<T: PartialEq + Copy>(values: impl IntoIterator<Item = T>) -> Vec<T> {
    let mut out: Vec<T> = Vec::new();
    for value in values {
        if !out.contains(&value) {
            out.push(value);
        }
    }
    out
}

/// Build a session, or say why it cannot start (TS `CreateAiSessionGrantUseCase.execute`).
///
/// Checks run in this order: AI enabled, disclosure accepted, encryption unlocked, workspace
/// name, at least one source, reading enabled per source, valid start time.
///
/// # Errors
///
/// Returns the user-facing message for the first failed check.
pub fn start_session(input: &SessionGrantInput) -> Result<ActiveSession, String> {
    if !input.settings.enabled {
        return Err("AI access is disabled.".to_owned());
    }
    let disclosed = input
        .settings
        .disclosure_accepted_at
        .as_deref()
        .is_some_and(|at| !at.is_empty());
    if !disclosed {
        return Err("Accept the AI disclosure first.".to_owned());
    }
    if !input.encryption_unlocked {
        return Err("Unlock encryption before starting AI access.".to_owned());
    }

    let workspace_name = input.workspace_name.trim();
    if workspace_name.is_empty() {
        return Err("Workspace name is required.".to_owned());
    }
    let sources = unique_session_sources(&input.sources);
    if sources.is_empty() {
        return Err("Select at least one source.".to_owned());
    }
    for source in &sources {
        let category = ai_read_category_for_resource(source.resource_type);
        if !input.settings.read_categories.contains(&category) {
            return Err(format!(
                "AI reading is not enabled for {}.",
                snake_case(source.resource_type)
            ));
        }
    }

    let now_ms = parse_instant(&input.now)
        .ok_or_else(|| "A valid session start time is required.".to_owned())?;
    let ttl_ms = clamp_session_ttl_ms(input.ttl_ms);
    let proposal_capabilities =
        dedupe(input.proposal_capabilities.iter().copied().filter(|kind| {
            input.settings.proposal_kinds.contains(kind)
                && !AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS.contains(kind)
        }));
    let started_at = format_instant(now_ms);

    Ok(ActiveSession {
        workspace: SessionWorkspace {
            id: input.id.clone(),
            name: workspace_name.to_owned(),
            sources: sources.clone(),
            created_at: started_at.clone(),
            updated_at: started_at.clone(),
        },
        grant: SessionGrant {
            id: input.id.clone(),
            workspace_id: input.id.clone(),
            expires_at: format_instant(now_ms + ttl_ms),
            readable: sources,
            allowed_tools: dedupe(input.allowed_tools.iter().copied()),
            proposal_capabilities,
            requires_confirmation_for_writes: true,
        },
        started_at,
    })
}

/// The wire name of a resource type, as the TS message spells it (`paper_note`, ...).
fn snake_case(resource_type: super::access_policy::AiResourceType) -> String {
    serde_json::to_value(resource_type)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::access_policy::{AiReadCategory, AiResourceType};

    const NOW: &str = "2026-11-10T10:00:00.000Z";

    fn source(resource_type: AiResourceType, resource_id: &str) -> AiWorkspaceSource {
        AiWorkspaceSource {
            source_id: format!("{resource_id}-src"),
            resource_type,
            resource_id: resource_id.to_owned(),
            label: None,
            href: None,
        }
    }

    fn settings() -> AiAccessSettings {
        AiAccessSettings {
            enabled: true,
            read_categories: vec![AiReadCategory::PaperMetadata],
            proposal_kinds: vec![AiProposalKind::PaperUpdate, AiProposalKind::Relation],
            auto_include_new_source_categories: None,
            disclosure_accepted_at: Some("2026-11-01T00:00:00.000Z".to_owned()),
        }
    }

    fn input() -> SessionGrantInput {
        SessionGrantInput {
            id: "s1".to_owned(),
            workspace_name: "  Lit review  ".to_owned(),
            sources: vec![source(AiResourceType::Paper, "p1")],
            settings: settings(),
            encryption_unlocked: true,
            now: NOW.to_owned(),
            ttl_ms: None,
            allowed_tools: vec![AiToolName::SearchWorkspace, AiToolName::SearchWorkspace],
            proposal_capabilities: vec![
                AiProposalKind::PaperUpdate,
                AiProposalKind::PaperUpdate,
                AiProposalKind::Relation,
                AiProposalKind::ReportEdit,
            ],
        }
    }

    #[test]
    fn ttl_defaults_and_clamps() {
        assert_eq!(clamp_session_ttl_ms(None), AI_SESSION_DEFAULT_TTL_MS);
        assert_eq!(
            clamp_session_ttl_ms(Some(f64::NAN)),
            AI_SESSION_DEFAULT_TTL_MS
        );
        assert_eq!(
            clamp_session_ttl_ms(Some(f64::INFINITY)),
            AI_SESSION_DEFAULT_TTL_MS
        );
        assert_eq!(clamp_session_ttl_ms(Some(0.0)), 1);
        assert_eq!(clamp_session_ttl_ms(Some(-5.0)), 1);
        assert_eq!(clamp_session_ttl_ms(Some(1500.9)), 1500);
        assert_eq!(clamp_session_ttl_ms(Some(1e18)), AI_SESSION_MAX_TTL_MS);
    }

    #[test]
    fn sources_dedupe_and_drop_empty_ids() {
        let sources = vec![
            source(AiResourceType::Paper, "p1"),
            source(AiResourceType::Paper, "p1"),
            source(AiResourceType::PaperNote, "p1"),
            source(AiResourceType::Paper, ""),
        ];
        let kept = unique_session_sources(&sources);
        assert_eq!(kept.len(), 2);
        assert_eq!(kept[1].resource_type, AiResourceType::PaperNote);
    }

    #[test]
    fn starts_with_trimmed_name_expiry_and_filtered_capabilities() {
        let session = start_session(&input()).expect("session starts");
        assert_eq!(session.workspace.name, "Lit review");
        assert_eq!(session.started_at, NOW);
        assert_eq!(session.grant.expires_at, "2026-11-10T10:30:00.000Z");
        assert_eq!(
            session.grant.proposal_capabilities,
            vec![AiProposalKind::PaperUpdate, AiProposalKind::Relation]
        );
        assert_eq!(
            session.grant.allowed_tools,
            vec![AiToolName::SearchWorkspace]
        );
        assert!(session.grant.requires_confirmation_for_writes);
    }

    #[test]
    fn checks_run_in_order_with_messages() {
        let mut bad = input();
        bad.settings.enabled = false;
        assert_eq!(start_session(&bad).unwrap_err(), "AI access is disabled.");

        let mut bad = input();
        bad.settings.disclosure_accepted_at = Some(String::new());
        assert_eq!(
            start_session(&bad).unwrap_err(),
            "Accept the AI disclosure first."
        );

        let mut bad = input();
        bad.encryption_unlocked = false;
        assert_eq!(
            start_session(&bad).unwrap_err(),
            "Unlock encryption before starting AI access."
        );

        let mut bad = input();
        bad.workspace_name = "   ".to_owned();
        assert_eq!(
            start_session(&bad).unwrap_err(),
            "Workspace name is required."
        );

        let mut bad = input();
        bad.sources.clear();
        assert_eq!(
            start_session(&bad).unwrap_err(),
            "Select at least one source."
        );

        let mut bad = input();
        bad.sources = vec![source(AiResourceType::PaperNote, "n1")];
        assert_eq!(
            start_session(&bad).unwrap_err(),
            "AI reading is not enabled for paper_note."
        );

        let mut bad = input();
        bad.now = "not a date".to_owned();
        assert_eq!(
            start_session(&bad).unwrap_err(),
            "A valid session start time is required."
        );
    }
}
