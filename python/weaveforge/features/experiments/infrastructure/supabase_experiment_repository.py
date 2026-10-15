"""Deprecated import path, kept for old code: use ``postgrest_experiment_repository``."""

from .postgrest_experiment_repository import PostgrestExperimentRepository, to_domain, to_row

SupabaseExperimentRepository = PostgrestExperimentRepository

__all__ = ["SupabaseExperimentRepository", "to_domain", "to_row"]
