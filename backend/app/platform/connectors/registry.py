"""Validated connector registry and manifest discovery (T2.2)."""
from __future__ import annotations
import importlib
import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional
from .base import Manifest, _REGISTRY, load_manifests

logger = logging.getLogger("platform.connectors.registry")

@dataclass(frozen=True)
class ProviderEntry:
    manifest: Manifest
    provider_class: type

class ConnectorRegistry:
    def __init__(self, providers_package: str = "app.platform.connectors.providers"):
        self.providers_package = providers_package
        self._entries: Dict[str, ProviderEntry] = {}
        self._discovered = False

    def discover(self, force: bool = False) -> Dict[str, ProviderEntry]:
        if self._discovered and not force:
            return dict(self._entries)
        importlib.import_module(self.providers_package)
        yaml_manifests = load_manifests(self.providers_package)
        yaml_by_id = {m.id: m for m in yaml_manifests}
        entries: Dict[str, ProviderEntry] = {}
        for cls in _REGISTRY.values():
            manifest = getattr(cls, "manifest", None)
            if not isinstance(manifest, Manifest):
                continue
            declared = yaml_by_id.get(manifest.id)
            if declared:
                if (declared.service_id != manifest.service_id
                        or declared.module != manifest.module):
                    raise ValueError(f"manifest mismatch for connector {manifest.id!r}")
                manifest = declared
            if manifest.id in entries:
                raise ValueError(f"duplicate connector id: {manifest.id}")
            entries[manifest.id] = ProviderEntry(manifest, cls)
        missing = sorted(set(yaml_by_id) - set(entries))
        if missing:
            raise ValueError("manifests have no registered provider: " + ", ".join(missing))
        self._entries = entries
        self._discovered = True
        logger.info("discovered %d connector providers", len(entries))
        return dict(entries)

    def get_class(self, connector_id: str) -> Optional[type]:
        entry = self.discover().get(connector_id)
        return entry.provider_class if entry else None

    def create(self, connector_id: str, config: Optional[Dict[str, Any]] = None):
        entry = self.discover().get(connector_id)
        if entry is None:
            return None
        try:
            return entry.provider_class(config or {})
        except TypeError as exc:
            raise TypeError(
                f"provider {connector_id!r} must accept a config dict"
            ) from exc

    def manifests(self) -> list[Manifest]:
        return [entry.manifest for _, entry in sorted(self.discover().items())]

registry = ConnectorRegistry()
