from __future__ import annotations

from typing import Any

from ....infrastructure.api_client import ApiClient
from ..domain.experiment import Experiment, ExperimentFilter
from .experiment_row import to_domain, to_row


class ApiExperimentRepository:
    def __init__(self, api: ApiClient, project_id: str | None = None) -> None:
        self._api = api
        self._pid = project_id

    def get_by_id(self, id: str) -> Experiment | None:
        # Not needed by the SDK runtime today; keep for interface parity.
        res = self._api.get("/api/sdk/experiments", params={"id": id})
        row = res.get("experiment")
        return to_domain(row) if row else None

    def list(self, filter: ExperimentFilter | None = None) -> list[Experiment]:
        # Future extension: add list endpoint with filters.
        raise NotImplementedError("Listing experiments via API is not implemented yet.")

    def save(self, entity: Experiment) -> None:
        row = to_row(entity)
        if self._pid:
            row["project_id"] = self._pid
        self._api.post("/api/sdk/experiments", json=row)

    def save_fields(self, id: str, fields: dict[str, Any]) -> None:
        # The server updates only the columns it receives and keeps the stored name.
        self._api.post("/api/sdk/experiments", json={**fields, "id": id})

    def delete(self, id: str) -> None:
        self._api.delete("/api/sdk/experiments", params={"id": id})
