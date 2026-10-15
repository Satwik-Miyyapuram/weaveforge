-- Migration: allow 'mattermost' as an integration provider.
-- For Mattermost the columns are reused: token = bot token, repo = server URL
-- (https://mm.example.com), branch = channel id. Owned by the `sync` module.

alter table project_integrations
  drop constraint if exists project_integrations_provider_check;

alter table project_integrations
  add constraint project_integrations_provider_check
  check (provider in ('github','gitlab','mattermost'));
