/**
 * The personal tables that 0165 moves out of the live schema. Copied from the SET SCHEMA list in
 * db/held/0165_drop_personal_tables.sql (branch feat/100-drop-personal-tables). An account with a
 * row in any of them still has data that only the 0.9.7 export moves.
 */
export const LEGACY_PERSONAL_TABLES = [
  "reader_annotations",
  "annotation_pins",
  "annotation_quotation_types",
  "paper_locus_anchors",
  "paper_field_values",
  "paper_field_defs",
  "paper_tags",
  "paper_relations",
  "reading_list_items",
  "screening_decisions",
  "citation_alert_tracks",
  "library_pins",
  "ai_audit_records",
  "ai_proposals",
  "project_integrations",
  "vault_pages",
  "log_entries",
  "report_sections",
  "tags",
  "reading_lists",
  "papers",
] as const;
