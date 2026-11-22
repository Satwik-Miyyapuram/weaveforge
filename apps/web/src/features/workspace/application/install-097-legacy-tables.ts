/**
 * One personal table 0165 moves out of the live schema, and how to count the signed-in user's rows
 * in it. `filter` is the owner column (the same owner rules as delete_user_account_data in
 * db/held/0165_drop_personal_tables.sql). Tables with no owner column of their own are filtered
 * through their parent: `select` embeds the parent with !inner so the filter applies to its owner.
 */
export interface LegacyTable {
  readonly table: string;
  readonly select: string;
  readonly filter: string;
}

const direct = (table: string, column = "user_id"): LegacyTable => ({ table, select: "*", filter: column });
const viaParent = (table: string, fk: string, parent: string): LegacyTable => ({
  table,
  select: `${fk}, ${parent}!inner(user_id)`,
  filter: `${parent}.user_id`,
});

/**
 * An account with a row in any of these still has data that only the 0.9.7 export moves.
 * Copied from the SET SCHEMA list in db/held/0165_drop_personal_tables.sql (branch feat/100-drop-personal-tables).
 */
export const LEGACY_PERSONAL_TABLES: readonly LegacyTable[] = [
  direct("reader_annotations"),
  direct("annotation_pins"),
  direct("annotation_quotation_types"),
  direct("paper_locus_anchors"),
  direct("paper_field_values"),
  direct("paper_field_defs"),
  viaParent("paper_tags", "paper_id", "papers"),
  direct("paper_relations"),
  viaParent("reading_list_items", "list_id", "reading_lists"),
  direct("screening_decisions", "reviewer_id"),
  direct("citation_alert_tracks"),
  direct("library_pins"),
  direct("ai_audit_records"),
  direct("ai_proposals"),
  viaParent("project_integrations", "project_id", "projects"),
  direct("vault_pages"),
  direct("log_entries"),
  direct("report_sections"),
  direct("tags"),
  direct("reading_lists"),
  direct("papers"),
];
