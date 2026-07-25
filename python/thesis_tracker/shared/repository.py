"""Generic data-access contracts.

Split into read and write halves so consumers depend only on what they need
(Interface Segregation Principle). These interfaces live in the domain layer;
concrete persistence (Supabase, in-memory) implements them in
``infrastructure`` — nothing here knows how data is stored (Dependency
Inversion). Faithful port of ``packages/core/src/shared/repository.ts``.

Repositories are synchronous: the Python SDK is used from training scripts,
and the ``supabase`` client's default surface is synchronous.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol, TypeVar, runtime_checkable

T = TypeVar("T")
T_co = TypeVar("T_co", covariant=True)  # read side only produces T
T_contra = TypeVar("T_contra", contravariant=True)  # write side only consumes T


@runtime_checkable
class Identifiable(Protocol):
    """An entity that can be persisted by id."""

    id: str


@runtime_checkable
class IReadableRepository(Protocol[T_co]):
    def get_by_id(self, id: str) -> T_co | None: ...

    # Sequence (not list) keeps T_co in a covariant position; concrete repos
    # still return a plain list, which satisfies Sequence.
    def list(self, filter: object | None = None) -> Sequence[T_co]: ...


@runtime_checkable
class IWritableRepository(Protocol[T_contra]):
    def save(self, entity: T_contra) -> None: ...

    def delete(self, id: str) -> None: ...


@runtime_checkable
class IRepository(Protocol[T]):
    """Convenience contract for the common read+write case. Declares the members
    directly with an invariant ``T`` (it both produces and consumes ``T``), which
    avoids the variance conflict of inheriting the covariant/contravariant halves.
    """

    def get_by_id(self, id: str) -> T | None: ...

    def list(self, filter: object | None = None) -> list[T]: ...

    def save(self, entity: T) -> None: ...

    def delete(self, id: str) -> None: ...
