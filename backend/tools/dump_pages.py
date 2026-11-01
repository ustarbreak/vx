#!/usr/bin/env python3
"""T0.2 — Dump frontend page inventory to docs/audit/pages.csv (read-only).

Parses src/App.tsx for <Route path=... element=...> entries and cross-references
each page component with the API layer it imports (src/services/*.ts) and with
useLiveFeed / demoWorld usage, which marks pages that silently fall back to mock
data. Output columns:

  path,component,lazy,api_imports,livefeed,demoworld,notes

Run from repo root:  python3 backend/tools/dump_pages.py
No files other than docs/audit/pages.csv are written.
"""
from __future__ import annotations

import csv
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP_TSX = os.path.join(ROOT, "src", "App.tsx")
OUT = os.path.join(ROOT, "docs", "audit", "pages.csv")


def find_component_file(component: str) -> list[str]:
    """Locate the file defining <component>: src/**/<Component>.tsx first, then a
    grep for `export (const|function) Component` / `export { Component }` to catch
    multi-component files like PartnerPortalPages.tsx."""
    hits = []
    for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, "src")):
        dirnames[:] = [d for d in dirnames if d != "node_modules"]
        for ext in (".tsx", ".ts"):
            for fn in filenames:
                if not fn.endswith(ext):
                    continue
                full = os.path.join(dirpath, fn)
                if fn == f"{component}{ext}":
                    hits.append(os.path.relpath(full, ROOT))
                    break
    if hits:
        return hits
    if not re.fullmatch(r"[A-Za-z0-9_]+", component):
        return hits  # e.g. "?" from unparseable element expr
    def_re = re.compile(
        r"export\s+(?:async\s+)?(?:function|const)\s+" + component + r"\b"
        r"|export\s*\{[^}]*\b" + component + r"\b"
    )
    for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, "src")):
        dirnames[:] = [d for d in dirnames if d != "node_modules"]
        for fn in filenames:
            if not fn.endswith((".tsx", ".ts")):
                continue
            full = os.path.join(dirpath, fn)
            try:
                body = open(full, encoding="utf-8").read()
            except OSError:
                continue
            if def_re.search(body):
                hits.append(os.path.relpath(full, ROOT))
    return hits


ROUTE_RE = re.compile(
    r"<Route\s+path=[\"'](?P<path>[^\"']+)[\"']\s+element=\{(?P<expr>[^}]+)\}", re.S
)
COMP_RE = re.compile(r"<([A-Z][A-Za-z0-9_]*)\s*/?>")
LAZY_RE = re.compile(r"(React\.lazy|lazy\()")
IMPORT_RE = re.compile(r"from\s+[\"'](?P<m>[^\"']+)[\"']")


def main() -> int:
    if not os.path.isfile(APP_TSX):
        print(f"missing {APP_TSX}", file=sys.stderr)
        return 1
    src = open(APP_TSX, encoding="utf-8").read()
    rows = []
    for m in ROUTE_RE.finditer(src):
        path = m.group("path")
        expr = m.group("expr")
        comp_m = COMP_RE.search(expr)
        component = comp_m.group(1) if comp_m else "?"
        lazy = bool(LAZY_RE.search(expr)) or ("Suspense" in expr)
        files = find_component_file(component)
        api_imports, livefeed, demoworld, notes = [], False, False, ""
        for rel in files[:1]:
            try:
                body = open(os.path.join(ROOT, rel), encoding="utf-8").read()
            except OSError:
                continue
            for im in IMPORT_RE.findall(body):
                if "/services/" in im or im.startswith("@/services"):
                    api_imports.append(im.split("/")[-1])
            livefeed = "useLiveFeed" in body
            demoworld = "demoWorld" in body or "mockData" in body
        if not files:
            notes = "component-file-not-found"
        rows.append({
            "path": path,
            "component": component,
            "lazy": "yes" if lazy else "no",
            "api_imports": ";".join(sorted(set(api_imports))),
            "livefeed": "yes" if livefeed else "no",
            "demoworld": "yes" if demoworld else "no",
            "notes": notes,
        })
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) if rows else
                           ["path", "component", "lazy", "api_imports",
                            "livefeed", "demoworld", "notes"])
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {len(rows)} rows -> {os.path.relpath(OUT, ROOT)}")
    n_live = sum(1 for r in rows if r["livefeed"] == "yes")
    n_mock = sum(1 for r in rows if r["demoworld"] == "yes")
    print(f"useLiveFeed pages: {n_live}; demo/mock-referencing pages: {n_mock}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
