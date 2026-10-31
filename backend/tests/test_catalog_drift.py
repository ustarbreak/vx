"""T1.2 — Catalog drift test.

The YAML catalog (backend/app/platform/catalog/services/) is generated from the
in-code sources of truth by tools/gen_catalog.py. This test keeps them in sync:
  1. Every YAML must load and pass ServiceSpec validation (incl. dependency
     referential integrity) via load_catalog().
  2. The set of catalog service ids must equal SERVICE_CONNECTORS keys, and
     every catalog entry marked in_seed must exist in seed.ALL_SERVICES.
  3. Regenerating from the Python sources must produce byte-identical YAMLs
     (i.e. nobody hand-edited a YAML without updating the generator/sources).

If (2) or (3) fails deliberately, either fix the Python source of truth and
re-run `python tools/gen_catalog.py`, or update this test's expectations —
never hand-edit the YAMLs (they are generated artifacts).
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.platform.catalog.schema import load_catalog  # noqa: E402
from app.services.connectors import SERVICE_CONNECTORS  # noqa: E402
from app.services.seed import ALL_SERVICES  # noqa: E402

CATALOG_DIR = BACKEND / "app" / "platform" / "catalog" / "services"
# Platform-internal pseudo-services (manual YAMLs whitelisted by gen_catalog.py).
INTERNAL_IDS = {"asset-discovery"}


def test_catalog_validates():
    specs = load_catalog()
    assert specs, "catalog is empty"


def test_ids_match_connectors_and_seed():
    specs = load_catalog()
    assert set(specs) == set(SERVICE_CONNECTORS) | INTERNAL_IDS, (
        "catalog ids drifted from SERVICE_CONNECTORS; re-run tools/gen_catalog.py"
    )
    seed_keys = set(ALL_SERVICES)  # seed.ALL_SERVICES is a list of service-key strings
    for sid, spec in specs.items():
        if spec.in_seed:
            assert sid in seed_keys, f"{sid}: marked in_seed but missing from seed.ALL_SERVICES"


def test_regeneration_is_stable(tmp_path):
    """gen_catalog.py into a temp dir must match the committed YAMLs exactly."""
    out = tmp_path / "services"
    proc = subprocess.run(
        [sys.executable, str(BACKEND / "tools" / "gen_catalog.py"), "--out", str(out)],
        capture_output=True, text=True, cwd=str(BACKEND),
    )
    assert proc.returncode == 0, proc.stderr
    generated = {p.name for p in out.glob("*.yaml")}
    committed = {p.name for p in CATALOG_DIR.glob("*.yaml")}
    assert generated == committed, f"file sets differ: {generated ^ committed}"
    for src in sorted(CATALOG_DIR.glob("*.yaml")):
        gen = out / src.name
        if src.stem in INTERNAL_IDS:
            continue  # manual file, copied verbatim only when absent in target
        assert gen.read_bytes() == src.read_bytes(), (
            f"{src.name} drifted from generated output; re-run tools/gen_catalog.py"
        )
