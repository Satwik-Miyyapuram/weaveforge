-- Explicit per-user opt-in and capability selection for the AI assistant.
-- This contains control metadata only; encrypted research content remains E2EE.
alter table user_settings
  add column if not exists ai_access jsonb;

comment on column user_settings.ai_access is
  'AI assistant opt-in and selected read/proposal capabilities; disabled by omission.';
