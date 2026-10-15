-- Extend paper custom fields with relation + rollup kinds.
alter table paper_field_defs
  drop constraint if exists paper_field_defs_kind_check;

alter table paper_field_defs
  add constraint paper_field_defs_kind_check
  check (kind in ('text', 'number', 'select', 'multi_select', 'relation', 'rollup'));

comment on table paper_field_defs is
  'Project-scoped custom field definitions for papers (text/number/select/multi_select/relation/rollup).';
