"""projects — minimal read-only slice.

The Python SDK doesn't manage projects (the PWA does); it only needs to resolve
a project *name* to the id it scopes experiments by, so a run lands under the
right project in the dashboard. Public API is the reader interface.
"""

from .domain.project_reader import IProjectReader

__all__ = ["IProjectReader"]
