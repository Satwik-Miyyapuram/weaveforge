"""Composition root.

The ONE place that knows concrete implementations and wires them to the
interfaces the rest of the SDK depends on (Dependency Inversion — the Python
mirror of ``apps/web/src/bootstrap.ts``).

The SDK authenticates with a single bearer token and talks to the web app's
`/api/sdk/*` endpoints (which apply RLS using the user's session token). This
keeps Supabase URL/keys out of training environments.
"""

from __future__ import annotations

from dataclasses import dataclass

from .config import Settings
from .features.experiments.application.manage_experiment import ManageExperimentUseCase
from .features.experiments.infrastructure.api_artifact_storage import ApiArtifactStorage
from .features.experiments.infrastructure.api_experiment_repository import ApiExperimentRepository
from .features.experiments.infrastructure.api_metric_repository import ApiMetricRepository
from .features.projects.infrastructure.api_project_reader import ApiProjectReader
from .infrastructure.api_client import ApiClient
from .shared.clock import SystemClock, UuidGenerator


@dataclass
class Container:
    """Wired dependencies. Everything downstream depends on the interfaces these
    implement, never on Supabase directly."""

    user_id: str
    project_id: str | None
    experiments: ApiExperimentRepository
    metrics: ApiMetricRepository
    artifacts: ApiArtifactStorage
    manage_experiment: ManageExperimentUseCase
    projects: ApiProjectReader
    api: ApiClient
    #: Kept so a long run can re-authenticate if the token rotates.
    _settings: Settings

    def resolve_project(self, name: str) -> str | None:
        """Look up a project id by name (RLS-scoped to you)."""
        return self.projects.id_by_name(name)

    def reauth(self) -> None:
        """No-op for bearer-token auth. If you rotate the token, create a new
        Container via connect()."""
        return None


def connect(settings: Settings | None = None, project: str | None = None) -> Container:
    """Build the container. ``project`` (a name) overrides the configured
    project for this connection."""
    settings = settings or Settings.from_env()
    api = ApiClient(settings.api_url, settings.token)
    who = api.get("/api/sdk/whoami")
    user_id = who.get("userId")
    if not user_id:
        raise RuntimeError("Token rejected by server (no userId).")

    projects = ApiProjectReader(api)
    project_name = project or settings.project_name
    project_id = settings.project_id if project is None else None
    if project_id is None and project_name:
        project_id = projects.id_by_name(project_name)
        if project_id is None:
            raise RuntimeError(
                f'No project named "{project_name}" found for this account. '
                "Create it in the dashboard, or set WEAVEFORGE_PROJECT_ID."
            )

    experiments = ApiExperimentRepository(api, project_id)
    metrics = ApiMetricRepository(api)
    artifacts = ApiArtifactStorage(api)
    manage = ManageExperimentUseCase(
        experiments, SystemClock(), UuidGenerator(), metrics
    )
    return Container(
        user_id=user_id,
        project_id=project_id,
        experiments=experiments,
        metrics=metrics,
        artifacts=artifacts,
        manage_experiment=manage,
        projects=projects,
        api=api,
        _settings=settings,
    )
