//! Port of the AI access policy in packages/core/src/features/ai-assistant/domain/ai-access-policy.ts and
//! the settings normalisation in ai-settings.ts (constants from ai-types.ts). Pure.

use crate::reader_analysis::lines::js_trim;

/// Read categories an AI session may be granted (TS `AI_READ_CATEGORIES`).
pub const AI_READ_CATEGORIES: &[AiReadCategory] = &[
    AiReadCategory::PaperMetadata,
    AiReadCategory::PaperNotes,
    AiReadCategory::ZoteroAnnotations,
    AiReadCategory::ReadingLists,
    AiReadCategory::VaultNotes,
    AiReadCategory::Logbook,
    AiReadCategory::Experiments,
];

/// Proposal kinds the assistant may suggest (TS `AI_PROPOSAL_KINDS`).
pub const AI_PROPOSAL_KINDS: &[AiProposalKind] = &[
    AiProposalKind::AppendPaperNote,
    AiProposalKind::CreateVaultNote,
    AiProposalKind::CreateLogEntry,
    AiProposalKind::PaperUpdate,
    AiProposalKind::PaperFieldValue,
    AiProposalKind::ReadingListChange,
    AiProposalKind::Relation,
    AiProposalKind::ZoteroImport,
    AiProposalKind::MilestoneFollowUp,
    AiProposalKind::ExperimentFollowUp,
    AiProposalKind::EditVaultNote,
    AiProposalKind::AppendVaultNote,
    AiProposalKind::ReportEdit,
    AiProposalKind::MilestoneStatus,
    AiProposalKind::ExperimentUpdate,
    AiProposalKind::PaperAnnotation,
];

/// Proposal kinds that need encrypted Zotero credentials (TS `AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS`).
/// Drafts do not access Zotero, so the list is empty.
pub const AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS: &[AiProposalKind] = &[];

/// Kinds of workspace resource (TS `AiResourceType`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum AiResourceType {
    /// A paper.
    Paper,
    /// A note on a paper.
    PaperNote,
    /// A Zotero annotation.
    ZoteroAnnotation,
    /// A Zotero note.
    ZoteroNote,
    /// A reading list.
    ReadingList,
    /// A citation graph.
    CitationGraph,
    /// A vault page.
    VaultPage,
    /// A logbook entry.
    LogEntry,
    /// An experiment.
    Experiment,
    /// A milestone.
    Milestone,
}

/// Categories of content an AI session may read (TS `AiReadCategory`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum AiReadCategory {
    /// Paper metadata.
    PaperMetadata,
    /// Paper notes.
    PaperNotes,
    /// Zotero annotations.
    ZoteroAnnotations,
    /// Reading lists.
    ReadingLists,
    /// Vault notes.
    VaultNotes,
    /// Logbook.
    Logbook,
    /// Experiments.
    Experiments,
}

/// Kinds of change the assistant may propose (TS `AiProposalKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum AiProposalKind {
    /// Append a paper note.
    AppendPaperNote,
    /// Create a vault note.
    CreateVaultNote,
    /// Create a log entry.
    CreateLogEntry,
    /// Update a paper.
    PaperUpdate,
    /// Set a paper field value.
    PaperFieldValue,
    /// Change a reading list.
    ReadingListChange,
    /// Add a relation.
    Relation,
    /// Import from Zotero.
    ZoteroImport,
    /// Follow up on a milestone.
    MilestoneFollowUp,
    /// Follow up on an experiment.
    ExperimentFollowUp,
    /// Edit a vault note.
    EditVaultNote,
    /// Append to a vault note.
    AppendVaultNote,
    /// Edit a report.
    ReportEdit,
    /// Change a milestone status.
    MilestoneStatus,
    /// Update an experiment.
    ExperimentUpdate,
    /// Annotate a paper.
    PaperAnnotation,
}

/// Tools the assistant can call (TS `AiToolName`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum AiToolName {
    /// Search the workspace.
    SearchWorkspace,
    /// Read an excerpt of a source.
    GetSourceExcerpt,
    /// Read the workspace outline.
    GetWorkspaceOutline,
    /// Suggest an appended paper note.
    SuggestAppendPaperNote,
    /// Suggest a new vault note.
    SuggestCreateVaultNote,
    /// Suggest a new log entry.
    SuggestCreateLogEntry,
    /// Suggest a paper update.
    SuggestPaperUpdate,
    /// Suggest a paper field value.
    SuggestPaperFieldValue,
    /// Suggest a reading list change.
    SuggestReadingListChange,
    /// Suggest a relation.
    SuggestRelation,
    /// Suggest a Zotero import.
    SuggestZoteroImport,
    /// Suggest a milestone follow-up.
    SuggestMilestoneFollowUp,
    /// Suggest an experiment follow-up.
    SuggestExperimentFollowUp,
}

/// Why a request is denied (TS `AiPolicyDenyReason`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum AiPolicyDenyReason {
    /// AI is switched off.
    AiDisabled,
    /// The disclosure was never accepted.
    DisclosureMissing,
    /// The encryption key is locked.
    EncryptionLocked,
    /// The session grant is expired or its date does not parse.
    GrantExpired,
    /// The resource is not in the grant.
    SourceNotGranted,
    /// The read category is turned off.
    CategoryDisabled,
    /// The tool is not in the grant.
    ToolNotAllowed,
    /// The proposal kind is not allowed.
    ProposalNotAllowed,
    /// The proposal needs credential protection.
    CredentialProtectionRequired,
}

/// Persisted AI access settings (TS `AiAccessSettings`). Field order matches `normalize_ai_access_settings`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AiAccessSettings {
    /// Whether AI access is on.
    pub enabled: bool,
    /// Read categories that are on.
    pub read_categories: Vec<AiReadCategory>,
    /// Proposal kinds that are on.
    pub proposal_kinds: Vec<AiProposalKind>,
    /// Categories that new sources are added to automatically.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub auto_include_new_source_categories: Option<Vec<AiReadCategory>>,
    /// When the disclosure was accepted, ISO 8601.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub disclosure_accepted_at: Option<String>,
}

/// Untrusted, partial settings as stored (TS `Partial<AiAccessSettings>`). Unknown list values are dropped.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AiAccessSettingsInput {
    /// Only `true` enables AI access.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub enabled: Option<bool>,
    /// Trimmed; blank means not accepted.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub disclosure_accepted_at: Option<String>,
    /// Raw read category names.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub read_categories: Option<Vec<String>>,
    /// Raw proposal kind names.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub proposal_kinds: Option<Vec<String>>,
    /// Raw auto-include category names.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub auto_include_new_source_categories: Option<Vec<String>>,
}

/// A resource the grant can read (TS `AiWorkspaceSource`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AiWorkspaceSource {
    /// Stable id of the source.
    pub source_id: String,
    /// Kind of resource.
    pub resource_type: AiResourceType,
    /// Id of the resource.
    pub resource_id: String,
    /// Display label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub label: Option<String>,
    /// Same-origin deep link.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub href: Option<String>,
}

/// A session grant (TS `AiSessionGrant`, without the literal `requiresConfirmationForWrites`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AiSessionGrant {
    /// Grant id.
    pub id: String,
    /// Workspace the grant belongs to.
    pub workspace_id: String,
    /// Expiry, ISO 8601.
    pub expires_at: String,
    /// Resources the grant can read.
    pub readable: Vec<AiWorkspaceSource>,
    /// Tools the grant allows.
    pub allowed_tools: Vec<AiToolName>,
    /// Proposal kinds the grant allows.
    pub proposal_capabilities: Vec<AiProposalKind>,
}

/// Inputs to one policy check (TS `AiPolicyInput`). The clock is passed to `evaluate_ai_access` separately.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AiPolicyInput {
    /// Current settings.
    pub settings: AiAccessSettings,
    /// Current session grant.
    pub grant: AiSessionGrant,
    /// Resource being read, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub resource_type: Option<AiResourceType>,
    /// Id of the resource being read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub resource_id: Option<String>,
    /// Tool being called.
    pub tool: AiToolName,
    /// Whether the encryption key is unlocked.
    pub encryption_unlocked: bool,
    /// Proposal being made, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub proposal_kind: Option<AiProposalKind>,
}

/// Allowed, or the reason it was denied (TS `AiPolicyDecision`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AiPolicyDecision {
    /// Whether the request is allowed.
    pub allowed: bool,
    /// Set only when `allowed` is false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub reason: Option<AiPolicyDenyReason>,
}

/// Read category that guards a resource type (TS `aiReadCategoryForResource`).
#[must_use]
pub const fn ai_read_category_for_resource(resource_type: AiResourceType) -> AiReadCategory {
    match resource_type {
        AiResourceType::Paper | AiResourceType::CitationGraph => AiReadCategory::PaperMetadata,
        AiResourceType::PaperNote => AiReadCategory::PaperNotes,
        AiResourceType::ZoteroAnnotation | AiResourceType::ZoteroNote => {
            AiReadCategory::ZoteroAnnotations
        }
        AiResourceType::ReadingList => AiReadCategory::ReadingLists,
        AiResourceType::VaultPage => AiReadCategory::VaultNotes,
        AiResourceType::LogEntry => AiReadCategory::Logbook,
        AiResourceType::Experiment | AiResourceType::Milestone => AiReadCategory::Experiments,
    }
}

/// Evaluate one request against the settings and grant (TS `AiAccessPolicy.evaluate`).
///
/// `now` is the ISO 8601 clock time. A grant date that does not parse, or a `now` that does not
/// parse, counts as expired (fail closed).
#[must_use]
pub fn evaluate_ai_access(input: &AiPolicyInput, now: &str) -> AiPolicyDecision {
    let reason = base_denial(input)
        .or_else(|| grant_denial(input, now))
        .or_else(|| tool_denial(input))
        .or_else(|| resource_denial(input))
        .or_else(|| proposal_denial(input));
    AiPolicyDecision {
        allowed: reason.is_none(),
        reason,
    }
}

/// Settings checks that come before any grant check.
fn base_denial(input: &AiPolicyInput) -> Option<AiPolicyDenyReason> {
    if !input.settings.enabled {
        return Some(AiPolicyDenyReason::AiDisabled);
    }
    if input
        .settings
        .disclosure_accepted_at
        .as_deref()
        .is_none_or(str::is_empty)
    {
        return Some(AiPolicyDenyReason::DisclosureMissing);
    }
    if !input.encryption_unlocked {
        return Some(AiPolicyDenyReason::EncryptionLocked);
    }
    None
}

/// Expiry check; written as "not still valid" so an unparsable date fails closed.
fn grant_denial(input: &AiPolicyInput, now: &str) -> Option<AiPolicyDenyReason> {
    match (parse_iso_ms(&input.grant.expires_at), parse_iso_ms(now)) {
        (Some(expires), Some(current)) if expires > current => None,
        _ => Some(AiPolicyDenyReason::GrantExpired),
    }
}

fn tool_denial(input: &AiPolicyInput) -> Option<AiPolicyDenyReason> {
    if input.grant.allowed_tools.contains(&input.tool) {
        None
    } else {
        Some(AiPolicyDenyReason::ToolNotAllowed)
    }
}

/// A resource type without an id cannot be checked against the grant, so it is denied.
fn resource_denial(input: &AiPolicyInput) -> Option<AiPolicyDenyReason> {
    let resource_type = input.resource_type?;
    let Some(resource_id) = input.resource_id.as_deref().filter(|id| !id.is_empty()) else {
        return Some(AiPolicyDenyReason::SourceNotGranted);
    };
    let granted =
        input.grant.readable.iter().any(|source| {
            source.resource_type == resource_type && source.resource_id == resource_id
        });
    if !granted {
        return Some(AiPolicyDenyReason::SourceNotGranted);
    }
    let category = ai_read_category_for_resource(resource_type);
    if input.settings.read_categories.contains(&category) {
        None
    } else {
        Some(AiPolicyDenyReason::CategoryDisabled)
    }
}

fn proposal_denial(input: &AiPolicyInput) -> Option<AiPolicyDenyReason> {
    let kind = input.proposal_kind?;
    if AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS.contains(&kind) {
        return Some(AiPolicyDenyReason::CredentialProtectionRequired);
    }
    let granted = input.grant.proposal_capabilities.contains(&kind)
        && input.settings.proposal_kinds.contains(&kind);
    if granted {
        None
    } else {
        Some(AiPolicyDenyReason::ProposalNotAllowed)
    }
}

/// Persisted settings with unknown and duplicate values dropped and fail-closed defaults
/// (TS `normalizeAiAccessSettings`).
#[must_use]
pub fn normalize_ai_access_settings(input: Option<&AiAccessSettingsInput>) -> AiAccessSettings {
    let empty = AiAccessSettingsInput::default();
    let input = input.unwrap_or(&empty);
    let disclosure_accepted_at = input
        .disclosure_accepted_at
        .as_deref()
        .map(js_trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    AiAccessSettings {
        enabled: input.enabled == Some(true),
        read_categories: unique_valid(input.read_categories.as_deref(), AI_READ_CATEGORIES),
        proposal_kinds: unique_valid(input.proposal_kinds.as_deref(), AI_PROPOSAL_KINDS),
        auto_include_new_source_categories: Some(unique_valid(
            input.auto_include_new_source_categories.as_deref(),
            AI_READ_CATEGORIES,
        )),
        disclosure_accepted_at,
    }
}

/// Keeps the first occurrence of each value that is in `allowed`, in input order.
fn unique_valid<T>(values: Option<&[String]>, allowed: &[T]) -> Vec<T>
where
    T: Copy + PartialEq + serde::de::DeserializeOwned,
{
    let mut out: Vec<T> = Vec::new();
    for value in values.unwrap_or(&[]) {
        let Ok(parsed) = serde_json::from_value::<T>(serde_json::Value::String(value.clone()))
        else {
            continue;
        };
        if allowed.contains(&parsed) && !out.contains(&parsed) {
            out.push(parsed);
        }
    }
    out
}

/// Cursor over an ISO 8601 string, byte by byte.
struct IsoCursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl IsoCursor<'_> {
    /// Reads exactly `count` ASCII digits.
    fn digits(&mut self, count: usize) -> Option<i64> {
        let mut value = 0_i64;
        for _ in 0..count {
            let byte = *self.bytes.get(self.pos)?;
            if !byte.is_ascii_digit() {
                return None;
            }
            value = value * 10 + i64::from(byte - b'0');
            self.pos += 1;
        }
        Some(value)
    }

    /// Consumes `byte` if it is next.
    fn eat(&mut self, byte: u8) -> bool {
        if self.bytes.get(self.pos) == Some(&byte) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn expect(&mut self, byte: u8) -> Option<()> {
        self.eat(byte).then_some(())
    }

    /// Fractional seconds as milliseconds; digits past the third are dropped.
    fn fraction_ms(&mut self) -> Option<i64> {
        let mut ms = 0_i64;
        let mut count = 0_usize;
        while let Some(byte) = self.bytes.get(self.pos).copied().filter(u8::is_ascii_digit) {
            if count < 3 {
                ms = ms * 10 + i64::from(byte - b'0');
            }
            count += 1;
            self.pos += 1;
        }
        if count == 0 {
            return None;
        }
        for _ in count.min(3)..3 {
            ms *= 10;
        }
        Some(ms)
    }
}

/// Minutes east of UTC; `Z` and a missing zone are both 0.
fn zone_offset_minutes(cursor: &mut IsoCursor) -> Option<i64> {
    if cursor.eat(b'Z') {
        return Some(0);
    }
    let sign = if cursor.eat(b'+') {
        1
    } else if cursor.eat(b'-') {
        -1
    } else {
        return Some(0);
    };
    let hours = cursor.digits(2)?;
    cursor.expect(b':')?;
    let minutes = cursor.digits(2)?;
    Some(sign * (hours * 60 + minutes))
}

/// `(year, month, day)` of `YYYY-MM-DD`, checked against the calendar.
fn parse_date(cursor: &mut IsoCursor) -> Option<(i64, i64, i64)> {
    let year = cursor.digits(4)?;
    cursor.expect(b'-')?;
    let month = cursor.digits(2)?;
    cursor.expect(b'-')?;
    let day = cursor.digits(2)?;
    if !(1..=12).contains(&month) || !(1..=days_in_month(year, month)).contains(&day) {
        return None;
    }
    Some((year, month, day))
}

/// `(milliseconds into the day, zone offset in minutes)` of `hh:mm[:ss[.sss]][zone]`.
fn parse_time(cursor: &mut IsoCursor) -> Option<(i64, i64)> {
    let hours = cursor.digits(2)?;
    cursor.expect(b':')?;
    let minutes = cursor.digits(2)?;
    let mut seconds = 0_i64;
    let mut millis = 0_i64;
    if cursor.eat(b':') {
        seconds = cursor.digits(2)?;
        if cursor.eat(b'.') {
            millis = cursor.fraction_ms()?;
        }
    }
    if hours > 23 || minutes > 59 || seconds > 59 {
        return None;
    }
    let offset = zone_offset_minutes(cursor)?;
    Some((
        ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis,
        offset,
    ))
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        2 if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Days since 1970-01-01 (proleptic Gregorian).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let year_of_era = y - era * 400;
    let shifted_month = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// Epoch milliseconds of an ISO 8601 date or date-time, or `None` where JS `Date.parse` gives NaN.
/// A date-time without a zone is read as UTC. Like V8, a space may stand for the `T`.
/// Unlike V8, an out-of-range day (Feb 30) does not roll over: it fails closed.
#[allow(
    clippy::cast_precision_loss,
    reason = "epoch ms for 4-digit years is below 2^53"
)]
fn parse_iso_ms(text: &str) -> Option<f64> {
    let mut cursor = IsoCursor {
        bytes: text.as_bytes(),
        pos: 0,
    };
    let (year, month, day) = parse_date(&mut cursor)?;
    let (ms_of_day, offset_minutes) = if cursor.eat(b'T') || cursor.eat(b' ') {
        parse_time(&mut cursor)?
    } else {
        (0, 0)
    };
    if cursor.pos != text.len() {
        return None;
    }
    let days = days_from_civil(year, month, day);
    let utc_ms = days * 86_400_000 + ms_of_day - offset_minutes * 60_000;
    Some(utc_ms as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> AiAccessSettings {
        AiAccessSettings {
            enabled: true,
            read_categories: AI_READ_CATEGORIES.to_vec(),
            proposal_kinds: AI_PROPOSAL_KINDS.to_vec(),
            auto_include_new_source_categories: None,
            disclosure_accepted_at: Some("2026-01-01T00:00:00.000Z".to_owned()),
        }
    }

    fn input(expires_at: &str) -> AiPolicyInput {
        AiPolicyInput {
            settings: settings(),
            grant: AiSessionGrant {
                id: "grant-1".to_owned(),
                workspace_id: "ws-1".to_owned(),
                expires_at: expires_at.to_owned(),
                readable: vec![AiWorkspaceSource {
                    source_id: "src-1".to_owned(),
                    resource_type: AiResourceType::Paper,
                    resource_id: "paper-1".to_owned(),
                    label: None,
                    href: None,
                }],
                allowed_tools: vec![AiToolName::SearchWorkspace],
                proposal_capabilities: vec![AiProposalKind::AppendPaperNote],
            },
            resource_type: Some(AiResourceType::Paper),
            resource_id: Some("paper-1".to_owned()),
            tool: AiToolName::SearchWorkspace,
            encryption_unlocked: true,
            proposal_kind: None,
        }
    }

    const NOW: &str = "2026-11-05T00:00:00.000Z";

    #[test]
    fn normalize_drops_unknown_and_duplicate_values() {
        let raw = AiAccessSettingsInput {
            enabled: Some(true),
            read_categories: Some(vec![
                "logbook".to_owned(),
                "nope".to_owned(),
                "logbook".to_owned(),
                "paper_notes".to_owned(),
            ]),
            ..AiAccessSettingsInput::default()
        };
        let normalized = normalize_ai_access_settings(Some(&raw));
        assert!(normalized.enabled);
        assert_eq!(
            normalized.read_categories,
            vec![AiReadCategory::Logbook, AiReadCategory::PaperNotes]
        );
        assert!(normalized.proposal_kinds.is_empty());
        assert_eq!(normalized.disclosure_accepted_at, None);
    }

    #[test]
    fn normalize_fails_closed_for_missing_input() {
        let normalized = normalize_ai_access_settings(None);
        assert!(!normalized.enabled);
        assert!(normalized.read_categories.is_empty());
    }

    #[test]
    fn normalize_trims_disclosure_and_drops_blank() {
        let padded = AiAccessSettingsInput {
            disclosure_accepted_at: Some("  2026-01-01  ".to_owned()),
            ..AiAccessSettingsInput::default()
        };
        assert_eq!(
            normalize_ai_access_settings(Some(&padded)).disclosure_accepted_at,
            Some("2026-01-01".to_owned())
        );
        let blank = AiAccessSettingsInput {
            disclosure_accepted_at: Some("   ".to_owned()),
            ..AiAccessSettingsInput::default()
        };
        assert_eq!(
            normalize_ai_access_settings(Some(&blank)).disclosure_accepted_at,
            None
        );
    }

    #[test]
    fn evaluate_allows_granted_resource() {
        let decision = evaluate_ai_access(&input("2099-01-01T00:00:00.000Z"), NOW);
        assert_eq!(
            decision,
            AiPolicyDecision {
                allowed: true,
                reason: None
            }
        );
    }

    #[test]
    fn evaluate_checks_settings_before_grant() {
        let mut disabled = input("2099-01-01T00:00:00.000Z");
        disabled.settings.enabled = false;
        assert_eq!(
            evaluate_ai_access(&disabled, NOW).reason,
            Some(AiPolicyDenyReason::AiDisabled)
        );
        let mut locked = input("not-a-date");
        locked.encryption_unlocked = false;
        assert_eq!(
            evaluate_ai_access(&locked, NOW).reason,
            Some(AiPolicyDenyReason::EncryptionLocked)
        );
    }

    #[test]
    fn evaluate_fails_closed_on_unparsable_or_past_expiry() {
        assert_eq!(
            evaluate_ai_access(&input("not-a-date"), NOW).reason,
            Some(AiPolicyDenyReason::GrantExpired)
        );
        assert_eq!(
            evaluate_ai_access(&input("2026-01-01T00:00:00.000Z"), NOW).reason,
            Some(AiPolicyDenyReason::GrantExpired)
        );
    }

    #[test]
    fn evaluate_denies_resource_without_id_and_disabled_category() {
        let mut no_id = input("2099-01-01T00:00:00.000Z");
        no_id.resource_id = None;
        assert_eq!(
            evaluate_ai_access(&no_id, NOW).reason,
            Some(AiPolicyDenyReason::SourceNotGranted)
        );
        let mut no_category = input("2099-01-01T00:00:00.000Z");
        no_category.settings.read_categories.clear();
        assert_eq!(
            evaluate_ai_access(&no_category, NOW).reason,
            Some(AiPolicyDenyReason::CategoryDisabled)
        );
    }

    #[test]
    #[allow(
        clippy::float_cmp,
        reason = "whole epoch milliseconds are exact in f64"
    )]
    fn iso_parse_matches_date_parse_for_valid_and_invalid_input() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:01.5Z"), Some(1500.0));
        assert_eq!(parse_iso_ms("1970-01-01T00:00:01+00:01"), Some(-59_000.0));
        assert_eq!(parse_iso_ms("2024-02-29"), Some(1_709_164_800_000.0));
        assert_eq!(parse_iso_ms("2024-02-30"), None);
        assert_eq!(parse_iso_ms("1970-01-01 00:00:01Z"), Some(1000.0));
        assert_eq!(parse_iso_ms("2026-11-05T00:00:00.000Z trailing"), None);
    }
}
