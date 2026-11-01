"""Connector provider base + registry (ADAPTED-PLAN T2.1/T2.2).

A provider is a thin, honest wrapper around an existing code path
(app/services/connectors.py probe/fetch functions, app/services/wazuh.py, or
native engines). Providers MUST NOT invent data: if a capability does not
exist they return JobState.unsupported (brief's honesty rule).

Discovery convention: each provider package under providers/ ships a
manifest.yaml with id/engine/service_id/capabilities. The registry loads
providers by module name matching the manifest `module` key.
"""
from __future__ import annotations

import importlib
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import yaml

from .models import ActionSpec, ActionResult, Detection, JobState

logger = logging.getLogger("platform.connectors")


@dataclass
class Manifest:
    id: str                       # connector id, e.g. "wazuh"
    engine: str                   # display name of backend engine
    service_id: str               # platform catalog service id
    module: str                   # python module under providers/
    capabilities: List[Dict[str, Any]] = field(default_factory=list)
    version_pin: str = ""         # TODO_VERIFY until installer runs once

    @classmethod
    def from_yaml(cls, text: str) -> "Manifest":
        d = yaml.safe_load(text)
        return cls(
            id=d["id"], engine=d["engine"], service_id=d["service_id"],
            module=d["module"], capabilities=d.get("capabilities", []),
            version_pin=d.get("version_pin", ""),
        )


class ConnectorProvider(ABC):
    """Base class every connector implements."""

    manifest: Manifest

    def __init__(self, config: Dict[str, Any]):
        self.config = config  # resolved via services/connectors.load_connector_config

    # --- read path (always implemented over existing pullers) -------------
    @abstractmethod
    async def probe(self) -> Dict[str, Any]:
        """Cheap liveness check. Delegates to probe_connector()."""

    @abstractmethod
    async def fetch_detections(self, limit: int = 50) -> List[Detection]:
        """Pull recent detections. Delegates to fetch_live_records()."""

    # --- write/action path -------------------------------------------------
    def actions(self) -> List[ActionSpec]:
        return [ActionSpec(name=c["name"], dangerous=c.get("dangerous", False),
                           description=c.get("description", ""))
                for c in self.manifest.capabilities]

    async def execute(self, action: str, params: Dict[str, Any],
                      dry_run: bool = False) -> ActionResult:
        """Default: honest unsupported. Providers override only what exists."""
        return ActionResult(state=JobState.unsupported,
                            message=f"provider '{self.manifest.id}' does not implement '{action}'")


_REGISTRY: Dict[str, type] = {}


def register(cls: type) -> type:
    _REGISTRY[cls.__name__] = cls
    logger.debug("registered connector provider %s", cls.__name__)
    return cls


def available_providers() -> List[str]:
    return sorted(_REGISTRY.keys())


def load_manifests(providers_pkg: str = "app.platform.connectors.providers") -> List[Manifest]:
    """Discover manifest.yaml files shipped next to provider modules."""
    import pkgutil, pathlib
    pkg = importlib.import_module(providers_pkg)
    out: List[Manifest] = []
    for modinfo in pkgutil.iter_modules(pkg.__path__):
        mpath = pathlib.Path(pkg.__file__).parent / modinfo.name / "manifest.yaml"
        if not (mpath.parent.is_dir() and mpath.exists()):
            # flat module form: <name>.yaml beside the module file
            alt = pathlib.Path(pkg.__file__).parent / f"{modinfo.name}.manifest.yaml"
            mpath = alt if alt.exists() else mpath
        if mpath.exists():
            try:
                out.append(Manifest.from_yaml(mpath.read_text()))
            except Exception as e:  # fail loudly in logs, never crash startup
                logger.error("bad manifest %s: %s", mpath, e)
    return out


def get_provider(connector_id: str, config: Dict[str, Any]) -> Optional[ConnectorProvider]:
    """Instantiate a registered provider by connector id (module.class lookup)."""
    for cls in _REGISTRY.values():
        m = getattr(cls, "manifest", None)
        if m and m.id == connector_id:
            return cls(config)
    return None
