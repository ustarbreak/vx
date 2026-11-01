#!/usr/bin/env python3
"""T4.1 — generate per-service guides from the platform catalog (docs/services/).

Reads backend/app/platform/catalog/*.yaml and renders one markdown page per
service plus _index.md, following the brief's guide format: what it is,
dependencies, install pointer, verification, capabilities with honest status.
Additive tool; run manually, output committed as docs. Usage:
    python backend/tools/gen_docs.py [--out docs/services]
"""
from __future__ import annotations
import argparse, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.platform.catalog.schema import load_catalog  # noqa: E402

STATUS_LABEL = {"ga": "GA (live in this app)", "beta": "Beta", "roadmap": "Roadmap — not implemented yet", "unsupported": "Unsupported"}

def render(sid, s) -> str:
    deps = "\n".join(f"- requires `{d.requires}` ({d.rationale})" for d in s.dependencies) or "- none"
    acts = "\n".join(
        f"| {a.name} | {'⚠ dangerous' if a.dangerous else 'safe'} | {STATUS_LABEL.get(a.status, a.status)} |"
        for a in s.actions) or "| _(no actions yet)_ | | |"
    return f"""# {s.name} (`{sid}`)

Status: **{s.status}** · Provider: `{s.provider}` · Engine: `{s.engine or '-'}` · In seed registry: {s.in_seed}

## What it is
Generated from the platform catalog (`backend/app/platform/catalog/{sid}.yaml`).
Do not edit by hand — regenerate with `python backend/tools/gen_docs.py`.

## Dependencies
{deps}

## Install
MVP engines (Wazuh, MISP, DFIR-IRIS): see `docs/guides/CONNECTOR-INSTALL.md`
and `deploy/install.sh --service {sid}` (compose profiles per owner decision #2/#8).
Other services: manual install, then register connection in the admin UI
(org-scoped via `org_id`, owner decision #3). TODO_VERIFY: image pins checked
on first real install only.

## Capabilities (canonical actions)
| action | gating | status |
|---|---|---|
{acts}

## Verify
After install: `GET /api/services/{sid}/status` and `/api/services/{sid}/live`
must report reachable before the checklist marks *connected*. First-success
criteria live in the corresponding `deploy/<engine>/verify.sh` when shipped.
"""

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default="docs/services"); a = ap.parse_args()
    out = ROOT / a.out; out.mkdir(parents=True, exist_ok=True)
    specs = load_catalog()
    rows = []
    for sid, s in sorted(specs.items()):
        (out / f"{sid}.md").write_text(render(sid, s))
        rows.append(f"| [{s.name}](./{sid}.md) | {s.status} | {s.provider} | {len(s.actions)} |")
    (out / "_index.md").write_text(
        "# Service guides (generated)\nSource of truth: `backend/app/platform/catalog/`.\n"
        "Regenerate: `python backend/tools/gen_docs.py`\n\n| service | status | provider | actions |\n|---|---|---|---|\n"
        + "\n".join(rows) + "\n")
    print(f"wrote {len(specs)} pages -> {out}")

if __name__ == "__main__":
    main()
