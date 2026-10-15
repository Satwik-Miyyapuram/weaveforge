-- Provider-specific integration settings. Mattermost keeps its per-event
-- switches and per-event channels here (apps/web/.../mattermost-options.ts).
alter table project_integrations
  add column if not exists options jsonb not null default '{}'::jsonb;

-- Existing Mattermost connections keep posting what they posted before.
update project_integrations
   set options = '{"events":{"milestoneAdded":true,"milestoneStatus":true,"citationAlerts":true},"sameChannel":true}'::jsonb
 where provider = 'mattermost' and options = '{}'::jsonb;
