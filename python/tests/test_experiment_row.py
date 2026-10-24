"""Both experiment repositories map rows with one shared module (xhelp-33)."""

from weaveforge.features.experiments.infrastructure import (
    api_experiment_repository,
    experiment_row,
    postgrest_experiment_repository,
    supabase_experiment_repository,
)


def test_repositories_share_one_row_mapping():
    repositories = (
        api_experiment_repository,
        postgrest_experiment_repository,
        supabase_experiment_repository,
    )
    for module in repositories:
        assert module.to_domain is experiment_row.to_domain
        assert module.to_row is experiment_row.to_row
