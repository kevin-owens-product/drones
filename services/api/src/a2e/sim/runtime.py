"""AutonomyRuntime port, in-process sim, and the FANTOM stub."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from a2e.behaviors.manifest import ManifestError, live_start_allowed, validate_manifest


class RuntimeUnavailable(RuntimeError):
    pass


@dataclass
class LoadedBehavior:
    handle: str
    manifest: dict[str, object]
    config: dict[str, object] = field(default_factory=dict)
    running: bool = False
    live: bool = False


class AutonomyRuntime(Protocol):
    async def load(self, manifest: dict[str, object]) -> str: ...

    async def configure(self, handle: str, config: dict[str, object]) -> None: ...

    async def start(self, handle: str, mission_state: str, *, live: bool) -> None: ...

    async def stop(self, handle: str, reason: str) -> None: ...

    async def status(self, handle: str) -> dict[str, object]: ...


class SimRuntime:
    def __init__(self) -> None:
        self._items: dict[str, LoadedBehavior] = {}
        self._seq = 0

    async def load(self, manifest: dict[str, object]) -> str:
        validate_manifest(manifest)
        self._seq += 1
        handle = f"sim-{self._seq}"
        self._items[handle] = LoadedBehavior(handle, manifest)
        return handle

    async def configure(self, handle: str, config: dict[str, object]) -> None:
        self._items[self._require(handle)].config = dict(config)

    async def start(self, handle: str, mission_state: str, *, live: bool) -> None:
        item = self._items[self._require(handle)]
        promotion = str(item.manifest["promotion"])
        if live and not live_start_allowed(promotion=promotion, mission_state=mission_state):
            raise ManifestError("live start requires flight_cleared and an approved mission")
        if not live and promotion not in {"sim_validated", "hitl_validated", "flight_cleared"}:
            raise ManifestError("package is not sim-validated")
        item.running = True
        item.live = live

    async def stop(self, handle: str, reason: str) -> None:
        del reason
        self._items[self._require(handle)].running = False

    async def status(self, handle: str) -> dict[str, object]:
        item = self._items[self._require(handle)]
        return {
            "handle": item.handle,
            "running": item.running,
            "live": item.live,
            "name": item.manifest["name"],
            "promotion": item.manifest["promotion"],
        }

    def _require(self, handle: str) -> str:
        if handle not in self._items:
            raise KeyError(handle)
        return handle


class FantomRuntime:
    """Adapter boundary for the government SDK, which is not in this build."""

    async def load(self, manifest: dict[str, object]) -> str:
        validate_manifest(manifest)
        # STUB: FANTOM Core SDK call — BehaviorLoader.load(manifest)
        raise RuntimeUnavailable("FANTOM Core SDK is not linked")

    async def configure(self, handle: str, config: dict[str, object]) -> None:
        del handle, config
        # STUB: FANTOM Core SDK call — BehaviorControl.configure
        raise RuntimeUnavailable("FANTOM Core SDK is not linked")

    async def start(self, handle: str, mission_state: str, *, live: bool) -> None:
        del handle, mission_state, live
        # STUB: FANTOM Core SDK call — BehaviorControl.start
        raise RuntimeUnavailable("FANTOM Core SDK is not linked")

    async def stop(self, handle: str, reason: str) -> None:
        del handle, reason
        # STUB: FANTOM Core SDK call — BehaviorControl.stop
        raise RuntimeUnavailable("FANTOM Core SDK is not linked")

    async def status(self, handle: str) -> dict[str, object]:
        del handle
        # STUB: FANTOM Core SDK call — BehaviorControl.status
        raise RuntimeUnavailable("FANTOM Core SDK is not linked")
