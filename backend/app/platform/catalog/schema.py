"""T1.1 — ServiceSpec: Pydantic model for the YAML service catalog.

Validated at load time by `catalog.load_catalog()`. The catalog is additive:
`PLATFORM_CATALOG_ENABLED` defaults to false and nothing consumes it unless
explicitly opted in (see ADAPTED-PLAN deviations).
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Literal, Optional

import yaml
from pydantic import BaseModel, Field, field_validator

STATUSES = ("ga", "beta", "roadmap")
PROVIDERS = ("native", "connector", "hybrid", "mock")


class Dependency(BaseModel):
    requires: str
    rationale: str = ""


class Resources(BaseModel):
    cpu: str = "2"
    memory: str = "2G"
    disk: str = "20G"

    @field_validator("memory", "disk")
    @classmethod
    def _unit(cls, v: str) -> str:
        if not re.fullmatch(r"\d+(M|G|T)", v):
            raise ValueError(f"resource size {v!r} must look like 512M/2G/50G")
        return v


class ActionSpec(BaseModel):
    name: str                      # canonical, e.g. host.collect
    method: Literal["GET", "POST", "PUT", "DELETE"] = "POST"
    dangerous: bool = False        # four-eyes / dry-run gating (T2.5)
    status: Literal["ga", "beta", "roadmap", "unsupported"] = "roadmap"


class ServiceSpec(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    name: str
    status: Literal["ga", "beta", "roadmap"]
    provider: Literal["native", "connector", "hybrid", "mock"] = "native"
    engine: str = ""
    docs_url: str = ""
    endpoints: Dict[str, str] = Field(default_factory=dict)
    resources: Resources = Field(default_factory=Resources)
    dependencies: List[Dependency] = Field(default_factory=list)
    in_seed: bool = False
    actions: List[ActionSpec] = Field(default_factory=list)
    deploy: Optional[Dict] = None   # installer metadata (Phase 3)

    @field_validator("actions")
    @classmethod
    def _unique_actions(cls, v: List[ActionSpec]) -> List[ActionSpec]:
        names = [a.name for a in v]
        if len(names) != len(set(names)):
            raise ValueError("duplicate action names in service spec")
        return v


def load_catalog(services_dir: Path | None = None) -> Dict[str, ServiceSpec]:
    """Load + validate every YAML under backend/app/platform/catalog/services/."""
    root = services_dir or Path(__file__).resolve().parent / "services"
    specs: Dict[str, ServiceSpec] = {}
    for path in sorted(root.glob("*.yaml")):
        data = yaml.safe_load(path.read_text())
        spec = ServiceSpec.model_validate(data)
        if spec.id != path.stem:
            raise ValueError(f"{path.name}: id {spec.id!r} does not match filename stem")
        specs[spec.id] = spec
    # referential integrity: every dependency target exists in the catalog
    for sid, spec in specs.items():
        for dep in spec.dependencies:
            if dep.requires not in specs:
                raise ValueError(f"{sid}: unknown dependency {dep.requires!r}")
    return specs
