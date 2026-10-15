"""The pre-rename Supabase* adapter import paths still resolve to the PostgREST classes."""

from weaveforge.features.experiments.infrastructure import (
    postgrest_artifact_storage,
    postgrest_experiment_repository,
    postgrest_metric_repository,
    supabase_artifact_storage,
    supabase_experiment_repository,
    supabase_metric_repository,
)
from weaveforge.features.projects.infrastructure import (
    postgrest_project_reader,
    supabase_project_reader,
)


def test_old_names_alias_new_classes():
    assert (
        supabase_artifact_storage.SupabaseArtifactStorage
        is postgrest_artifact_storage.PostgrestArtifactStorage
    )
    assert (
        supabase_experiment_repository.SupabaseExperimentRepository
        is postgrest_experiment_repository.PostgrestExperimentRepository
    )
    assert supabase_experiment_repository.to_row is postgrest_experiment_repository.to_row
    assert (
        supabase_metric_repository.SupabaseMetricRepository
        is postgrest_metric_repository.PostgrestMetricRepository
    )
    assert (
        supabase_project_reader.SupabaseProjectReader
        is postgrest_project_reader.PostgrestProjectReader
    )
