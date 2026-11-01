#!/usr/bin/env python3
"""T1.2 — Generate the service catalog YAMLs from the in-code sources of truth.

Reads `app.services.connectors.SERVICE_CONNECTORS`, `app.services.seed.ALL_SERVICES`
and `app.services.service_graph.SERVICE_DEPENDENCY_RULES` and writes one YAML per
service under backend/app/platform/catalog/services/. Re-run any time the Python
sources change; the drift test (backend/tests/test_catalog_drift.py) keeps the
two in sync.

Usage: cd backend && python tools/gen_catalog.py
"""
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
sys.path.insert(0, str(BACKEND))

from app.services.connectors import SERVICE_CONNECTORS  # noqa: E402
from app.services.seed import ALL_SERVICES  # noqa: E402
from app.services.service_graph import SERVICE_DEPENDENCY_RULES  # noqa: E402

OUT_DIR = BACKEND / "app" / "platform" / "catalog" / "services"

# Lifecycle/status vocabulary (ALIGNMENT.md legend): ga | beta | roadmap
DEFAULT_STATUS = {
    "vuln-scanning": "roadmap",   # Greenbone deferred to Phase 6 T6.0 (owner decision #8)
    "sd-wan": "roadmap",
    "cloud-security": "beta",
    "dns-filtering": "beta",
    "email-security": "beta",
}

# Container resource needs — conservative defaults (owner decision #7). TODO_VERIFY on real host.
DEFAULT_RESOURCES = {"cpu": "2", "memory": "2G", "disk": "20G"}
HEAVY_RESOURCES = {
    "network-monitoring": {"cpu": "4", "memory": "4G", "disk": "50G"},  # Wazuh indexer+dashboard
    "analytics": {"cpu": "2", "memory": "2G", "disk": "20G"},           # Grafana (+Loki)
}

# T2.6 canonical actions per service (owner decision #6: thin adapter over the
# engines that already exist). Source of truth for WHAT may execute is
# app/platform/native_actions.py:execute_native; here we only declare which
# service exposes which action and its gating. `dangerous: true` keeps the
# four-eyes/dry-run gate in the SOAR engine. Anything not listed stays honest:
# POST /api/platform/actions answers "unsupported" for it.
NATIVE_ACTIONS: dict[str, list[dict]] = {
    "advanced-ticketing": [
        {"name": "case.create", "method": "POST", "dangerous": False, "status": "ga"},
        {"name": "case.update", "method": "POST", "dangerous": False, "status": "ga"},
    ],
    "incident-response": [
        {"name": "incident.create", "method": "POST", "dangerous": False, "status": "ga"},
        {"name": "incident.status", "method": "POST", "dangerous": False, "status": "ga"},
    ],
    "soar": [
        {"name": "playbook.run", "method": "POST", "dangerous": True, "status": "ga"},
    ],
}


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(OUT_DIR), help="output directory for YAMLs")
    args = ap.parse_args(argv)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    deps_by_service: dict[str, list] = {}
    for rule in SERVICE_DEPENDENCY_RULES:
        deps_by_service.setdefault(rule["service"], []).append(
            {"requires": rule["requires"], "rationale": rule.get("rationale", "")}
        )

    written = 0
    # Platform-internal pseudo-services that exist in the catalog but not in
    # SERVICE_CONNECTORS (manual YAMLs, kept here so regeneration stays complete).
    EXTRA_IDS = {"asset-discovery"}
    for sid in sorted(set(SERVICE_CONNECTORS) | EXTRA_IDS):
        meta = SERVICE_CONNECTORS.get(sid, {})
        if sid in EXTRA_IDS:
            existing = out_dir / f"{sid}.yaml"
            if existing.exists():
                continue  # manual file is the source of truth; leave untouched
        spec = {
            "id": sid,
            "name": sid.replace("-", " ").title(),
            "status": DEFAULT_STATUS.get(sid, "ga"),
            "provider": "native",              # nothing switches by default (plan §deviations)
            "engine": meta.get("engine", ""),
            "docs_url": meta.get("docs", ""),
            "endpoints": meta.get("endpoints", {}),
            "resources": HEAVY_RESOURCES.get(sid, DEFAULT_RESOURCES),
            "dependencies": deps_by_service.get(sid, []),
            "in_seed": sid in ALL_SERVICES,
            "actions": NATIVE_ACTIONS.get(sid, []),   # T2.6 canonical actions (see NATIVE_ACTIONS above)
            "_generated_from": [
                "app/services/connectors.py:SERVICE_CONNECTORS",
                "app/services/seed.py:ALL_SERVICES",
                "app/services/service_graph.py:SERVICE_DEPENDENCY_RULES",
            ],
        }
        (out_dir / f"{sid}.yaml").write_text(
            yaml.safe_dump(spec, sort_keys=False, allow_unicode=True)
        )
        written += 1
    print(f"Wrote {written} service YAMLs -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
