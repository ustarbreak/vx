#!/usr/bin/env python3
"""T1.4 — generate architecture diagrams + service x page x route matrix.

Reads:  backend/app/platform/catalog/services/*.yaml (+ components if present)
        backend/app/services/service_graph.py SERVICE_DEPENDENCY_RULES
        docs/audit/routes.csv, docs/audit/pages.csv
Writes: docs/architecture/platform.mmd
        docs/architecture/services/<id>.mmd
        docs/audit/service-page-route.csv
Pure stdlib + PyYAML (already a backend dep). Run from repo root or anywhere.
"""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "backend" / "app" / "platform" / "catalog" / "services"
AUDIT = ROOT / "docs" / "audit"
OUTDIR = ROOT / "docs" / "architecture"


def load_yaml(path: Path) -> dict:
    """Minimal YAML loader for our flat catalog files (scalars + lists of scalars)."""
    try:
        import yaml  # type: ignore
        return yaml.safe_load(path.read_text()) or {}
    except Exception:
        data: dict = {}
        key = None
        for raw in path.read_text().splitlines():
            line = raw.split("#", 1)[0].rstrip()
            if not line.strip():
                continue
            if re.match(r"^\S", line) and line.endswith(":"):
                key = line[:-1].strip()
                data[key] = []
            elif line.lstrip().startswith("- ") and key:
                data[key].append(line.lstrip()[2:].strip().strip('"\''))
            elif re.match(r"^\S[^:]*:", line):
                k, v = line.split(":", 1)
                data[k.strip()] = v.strip().strip('"\'')
                key = None
        return data


def slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "_", name)


def main() -> int:
    services = sorted(CATALOG.glob("*.yaml"))
    if not services:
        print(f"no catalog yamls under {CATALOG}", file=sys.stderr)
        return 1

    specs = {p.stem: load_yaml(p) for p in services}

    # dependency rules from live code (fallback to catalog 'depends_on')
    deps: dict[str, list[str]] = {}
    for sid, spec in specs.items():
        d = spec.get("depends_on") or []
        if isinstance(d, str):
            d = [d]
        deps[sid] = [x for x in d if x in specs]

    # ---- platform.mmd ----
    lines = ["graph LR"]
    for sid, spec in sorted(specs.items()):
        status = str(spec.get("status", "roadmap"))
        shape = f'{slug(sid)}["{sid}\\n({status})"]'
        lines.append(f"  {shape}")
    for sid, ds in sorted(deps.items()):
        for d in ds:
            lines.append(f"  {slug(d)} --> {slug(sid)}")
    OUTDIR.mkdir(parents=True, exist_ok=True)
    (OUTDIR / "platform.mmd").write_text("\n".join(lines) + "\n")

    # ---- per-service mmd ----
    svcdir = OUTDIR / "services"
    svcdir.mkdir(exist_ok=True)
    for sid, spec in sorted(specs.items()):
        eng = spec.get("native_engines") or []
        if isinstance(eng, str):
            eng = [eng]
        out = [f"graph LR", f'  self["{sid}"]']
        for e in eng:
            out.append(f'  {slug(str(e))}[("{e}")]')
            out.append(f"  {slug(str(e))} --> self")
        for d in deps.get(sid, []):
            out.append(f'  {slug(d)}["{d}"]')
            out.append(f"  {slug(d)} --> self")
        (svcdir / f"{sid}.mmd").write_text("\n".join(out) + "\n")

    # ---- service x page x route matrix ----
    routes = pages = []
    try:
        routes = list(csv.DictReader(open(AUDIT / "routes.csv")))
        pages = list(csv.DictReader(open(AUDIT / "pages.csv")))
    except FileNotFoundError as e:
        print(f"warning: {e}; matrix will be partial", file=sys.stderr)

    def blob(row: dict) -> str:
        return " ".join(str(v) for v in row.values()).lower()

    matrix_path = AUDIT / "service-page-route.csv"
    with open(matrix_path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["service", "status", "depends_on", "pages", "route_count"])
        for sid, spec in sorted(specs.items()):
            hits_p = [p["path"] for p in pages if sid in blob(p)]
            n_r = sum(1 for r in routes if sid in blob(r))
            w.writerow([sid, spec.get("status", ""), "|".join(deps.get(sid, [])),
                        "|".join(hits_p), n_r])

    print(f"wrote {OUTDIR/'platform.mmd'}, {len(specs)} per-service mmd, {matrix_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
