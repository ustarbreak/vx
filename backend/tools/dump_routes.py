#!/usr/bin/env python3
"""T0.1 — Dump every FastAPI route to docs/audit/routes.csv (read-only audit tool).

Columns: method, path, handler, router_module, auth_dependency, classification.
Classification heuristic: real | stub | mock — based on handler source text
(returns hardcoded dict/list => mock; raises NotImplementedError or returns
"not implemented" => stub; otherwise real). Verify manually where unsure.

Usage:  cd backend && python tools/dump_routes.py [--out ../docs/audit/routes.csv]
"""
import argparse
import csv
import inspect
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
sys.path.insert(0, str(BACKEND))


def classify(route) -> str:
    endpoint = getattr(route, "endpoint", None)
    if endpoint is None:
        return "unknown"
    try:
        src = inspect.getsource(endpoint)
    except (OSError, TypeError):
        return "unknown"
    low = src.lower()
    if "notimplementederror" in low or "not implemented" in low or "todo: implement" in low:
        return "stub"
    body = re.sub(r'""".*?"""', "", src, flags=re.S)
    lines = [l.strip() for l in body.splitlines()
             if l.strip() and not l.strip().startswith(("#", "async def", "def ", "@"))]
    if lines and all(l.startswith(("return {", "return [", "return dict(",
                                   "return MOCK", "return DEMO")) for l in lines[:2]):
        return "mock"
    return "real"


def auth_dep(route) -> str:
    deps = []
    for d in getattr(route, "dependencies", []) or []:
        call = getattr(d, "dependency", None)
        deps.append(getattr(call, "__name__", str(call)) if call else "Depends(...)")
    try:
        sig = inspect.signature(route.endpoint)
        for p in sig.parameters.values():
            ann = str(p.default)
            if "get_current_user" in ann or "require_role" in ann or "current_user" in p.name:
                deps.append(p.name)
    except (ValueError, TypeError):
        pass
    return ";".join(sorted(set(deps))) or "NONE"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(BACKEND.parent / "docs" / "audit" / "routes.csv"))
    args = ap.parse_args()

    try:
        from app.main import app  # type: ignore
    except Exception as exc:  # noqa: BLE001
        print(f"WARN: could not import app.main ({exc}); trying create_app", file=sys.stderr)
        try:
            from app.main import create_app  # type: ignore
            app = create_app()
        except Exception as exc2:  # noqa: BLE001
            print(f"ERROR: cannot load FastAPI app: {exc2}", file=sys.stderr)
            return 1

    rows = []
    for route in app.routes:
        if not hasattr(route, "endpoint") and not hasattr(route, "methods"):
            continue  # Mount / StaticFiles — recorded separately below
        methods = getattr(route, "methods", None) or []
        path = getattr(route, "path", "")
        endpoint = getattr(route, "endpoint", None)
        module = getattr(endpoint, "__module__", "") if endpoint else ""
        name = getattr(endpoint, "__name__", "") if endpoint else ""
        if not methods:
            methods = ["WS"] if "websocket" in type(route).__name__.lower() else ["MOUNT"]
        for m in sorted(methods):
            rows.append({
                "method": m,
                "path": path,
                "handler": f"{module}.{name}" if module else name,
                "router": module.replace("app.", ""),
                "auth": auth_dep(route),
                "classification": classify(route),
            })
    rows.sort(key=lambda r: (r["path"], r["method"]))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["method", "path", "handler", "router", "auth", "classification"])
        w.writeheader()
        w.writerows(rows)
    print(f"Wrote {len(rows)} routes -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
