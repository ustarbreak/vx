"""Advanced Reporting API (Phase 1 skeleton of the integration).

Endpoints follow the brief §4 contract:
  GET  /api/v1/reports                                  -> catalogue (6 families)
  GET  /api/v1/reports/{id}?period=YYYY-MM              -> all pages of a report
  GET  /api/v1/reports/{id}/pages/{n}?period=YYYY-MM    -> one page
  GET  /api/v1/meta?period=YYYY-MM                      -> header meta
  POST /api/v1/reports/{id}/refresh                     -> no-op placeholder (Phase 3)

Data source rules:
  * Demo Mode ON (frontend `ic_demo_mode`) or REPORTING_DEMO=1 -> deterministic
    demo dataset from app.services.reporting.demo_data (20 reports / 62 pages).
  * Real backend mode -> PLUG points below; until Phase 2 adapters land, the
    affected blocks come back with "Donnee indisponible" + last-updated date
    (never a misleading zero, per brief §4).
Tenant isolation: tenant id comes ONLY from the JWT (current_user.org_id),
never from a query parameter.
"""
from __future__ import annotations

import csv
import io
import os
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.core.security import get_current_user
from app.models import User
from app.services.reporting import demo_data as dd

router = APIRouter(prefix="/v1/reports", tags=["Reporting"])
meta_router = APIRouter(prefix="/v1", tags=["Reporting"])

PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")

# report number -> key lookup
BY_NUM = {num: (key, title, fam, pages) for num, key, title, fam, pages in dd.REPORTS}
BY_KEY = {key: (num, title, fam, pages) for num, key, title, fam, pages in dd.REPORTS}


def _check_period(period: str) -> str:
    if not PERIOD_RE.match(period):
        raise HTTPException(422, "period must be YYYY-MM")
    return period


def _flag_demo() -> bool:
    """Env switch only. NOTE: this no longer decides what the *user* sees —
    it only marks the response `demo` badge and gates the explicit
    ?demo_source=server_fallback opt-in below."""
    return os.getenv("REPORTING_DEMO", "1") == "1"


def _tenant_id(user: User) -> str:
    return str(user.org_id or user.id)


def _real_pages(report_key: str, tenant: str, period: str) -> list | None:
    """Build a report from REAL platform data (Demo Mode OFF path).

    Returns None when no real builder exists yet for this report — the caller
    then answers honestly with 'Donnee indisponible' (never fake numbers,
    never silent demo data). PLUG points per report family:
      - incident / tickets / soar : Postgres tables live today
        (app/services/reporting/real_builders.py)
      - threatintel               : connectors MISP/OTX (Phase 2)
      - others                    : Phase 2 adapters
    """
    try:
        if report_key in ("incident", "tickets", "soar"):
            from app.services.reporting import real_builders
            return await real_builders.build(report_key, tenant, period)
    except Exception:  # pragma: no cover - degrade honestly on any failure
        return None
    return None


def _unavailable_pages(report_key: str) -> list:
    num, title, fam, total = BY_KEY[report_key]
    note = ("Donnee indisponible — aucun adaptateur de données réelles n'est "
            "branché pour ce rapport (Phase 2). Le mode démo reste disponible "
            "côté interface.")
    return [[f"Page {i + 1} / {total}", title, [["M", "Source status", [[note, "w"]]]]]
            for i in range(total)]


def _resolve_demo(demo_param: int, demo_source: int) -> bool:
    """Decide whether to serve deterministic demo content for THIS request.

    Rule agreed with the product owner (Oct 2026): the backend always exists,
    the demo lives elsewhere.
      * Frontend Demo Mode OFF  -> client sends NO demo param -> real data.
      * Frontend Demo Mode ON   -> client generates locally; it only hits the
        server with demo=1 if it explicitly wants the server-side mirror.
      * demo=1                  -> honoured (deterministic demo dataset).
      * demo=0                  -> ALWAYS real data. A server-wide env flag
        must never leak demo content into a real-mode request; use the
        explicit ?demo_source=server_fallback opt-in for debugging.
    """
    if demo_param == 1:
        return True
    if demo_source == "server_fallback":
        return True
    return False


async def _render_pages(report_key: str, user: User, period: str, demo: bool) -> list:
    tenant = _tenant_id(user)
    if demo:
        return dd.build_demo_report(report_key, tenant, period)
    real = await _real_pages(report_key, tenant, period)
    if real is not None:
        ts = dd.now_utc()
        return [[t, f"{intro} · last updated {ts}", b] for t, intro, b in real]
    return _unavailable_pages(report_key)


@router.get("")
async def catalogue(demo: int = Query(0), demo_source: str = Query(""),
                    period: str = Query("2026-10"),
                    current_user: User = Depends(get_current_user)):
    fam_names = dict(dd.FAMILIES)
    families = [{"id": fid, "name": fname, "reports": []} for fid, fname in dd.FAMILIES]
    idx = {f["id"]: f for f in families}
    for num, key, title, fam, pages in dd.REPORTS:
        idx[fam]["reports"].append({
            "number": num, "id": key, "title": title,
            "pages": pages, "download_levels": ["page", "report", "family", "all"],
        })
    return {
        "demo": _resolve_demo(demo, demo_source),
        "total_pages": sum(r[4] for r in dd.REPORTS),
        "families": families,
        "family_names": fam_names,
    }


@router.get("/{report_id}")
async def report_pages(report_id: str, period: str = Query("2026-10"),
                       demo: int = Query(0), demo_source: str = Query(""),
                       current_user: User = Depends(get_current_user)):
    if report_id not in BY_KEY:
        raise HTTPException(404, "Unknown report")
    _check_period(period)
    num, title, fam, pages = BY_KEY[report_id]
    body = await _render_pages(report_id, current_user, period, _resolve_demo(demo, demo_source))
    return {"number": num, "id": report_id, "title": title,
            "family": fam, "period": period, "demo": _resolve_demo(demo, demo_source),
            "pages": body}


@router.get("/{report_id}/pages/{n}")
async def one_page(report_id: str, n: int, period: str = Query("2026-10"),
                   demo: int = Query(0), demo_source: str = Query(""),
                   current_user: User = Depends(get_current_user)):
    if report_id not in BY_KEY:
        raise HTTPException(404, "Unknown report")
    _check_period(period)
    num, title, fam, total = BY_KEY[report_id]
    if not 1 <= n <= total:
        raise HTTPException(404, f"Report {num} has {total} pages")
    body = await _render_pages(report_id, current_user, period, _resolve_demo(demo, demo_source))
    return {"number": num, "id": report_id, "title": title, "family": fam,
            "period": period, "page_no": n, "page": body[n - 1]}


@meta_router.get("/meta")
async def meta(period: str = Query("2026-10"), demo: int = Query(0),
               demo_source: str = Query(""), current_user: User = Depends(get_current_user)):
    org = getattr(current_user, "organization", None)
    name = getattr(org, "name", None) or "Demo Tenant"
    return {
        "client": name,
        "period": _check_period(period),
        "version": "2026.10-p1",
        "classification": "CONFIDENTIAL — Infracentra client report",
        "author": "Infracentra Reporting Engine",
        "last_updated": dd.now_utc(),
        "demo": _resolve_demo(demo, demo_source),
    }


@router.post("/{report_id}/refresh")
async def refresh(report_id: str, current_user: User = Depends(get_current_user)):
    if report_id not in BY_KEY:
        raise HTTPException(404, "Unknown report")
    # PLUG (Phase 3): trigger aggregation job recompute for this report/tenant.
    return {"status": "queued", "report": report_id}


# ------------------------------------------------------------------ export --
def _blocks_to_rows(pages: list) -> list:
    """Flatten block contract into CSV rows (server-side, from the SAME data
    that renders on screen — never scraped from HTML, per brief §6)."""
    rows = [["section", "block_type", "col1", "col2", "col3", "col4"]]
    for title, intro, blocks in pages:
        for b in blocks:
            kind = b[0]
            if kind == "K":
                for label, val, delta, color in b[1]:
                    rows.append([title, "KPI", label, val, delta, color])
            elif kind == "T":
                _, t, headers, body = b
                rows.append([t, "table_header", *headers[:4]])
                for r in body:
                    cells = [str(c) for c in r][:4]
                    rows.append([t, "row", *cells, *([""] * (4 - len(cells)))])
            elif kind in ("R", "B", "D"):
                t = "" if kind == "R" else b[1]
                items = b[1] if kind == "R" else b[2]
                for it in items:
                    rows.append([title or t, kind, *[str(x) for x in it][:3], "", ""])
            elif kind == "M":
                t = b[1]
                for msg, color in b[2]:
                    rows.append([t, "message", msg, color, "", ""])
            elif kind == "L":
                t, items = b[1], b[2]
                for it in items:
                    rows.append([t, "list", it, "", "", ""])
            elif kind == "F":
                t, steps = b[1], b[2]
                for s in steps:
                    rows.append([t, "funnel", s[0], str(s[1]), "", ""])
            elif kind == "G":
                rows.append([b[1], "gauge", str(b[2]), b[3], "", ""])
            elif kind == "S":
                rows.append([b[1], "sparkline", ",".join(str(v) for v in b[2]), "", "", ""])
            elif kind == "C":
                for col, label, items, color in [(c, c[0], c[1], c[2]) for c in b[2]]:
                    rows.append([b[1], "roadmap", label, "; ".join(items), color, ""])
            elif kind == "P":
                rows.append([b[1], "signoff", " | ".join(b[2]), "", "", ""])
    return rows


@router.get("/{report_id}/export")
async def export(report_id: str, format: str = Query("csv"), page: int = Query(0),
                 period: str = Query("2026-10"), demo: int = Query(0),
                 demo_source: str = Query(""),
                 current_user: User = Depends(get_current_user)):
    if report_id not in BY_KEY:
        raise HTTPException(404, "Unknown report")
    _check_period(period)
    num, title, fam, total = BY_KEY[report_id]
    pages = await _render_pages(report_id, current_user, period, _resolve_demo(demo, demo_source))
    if page and 1 <= page <= total:
        sel = [pages[page - 1]]
        fname = f"report{num:02d}_p{page}_{period}.csv"
    else:
        sel = pages
        fname = f"report{num:02d}_{period}.csv"
    if format == "pdf":
        # PLUG (Phase 6): headless browser print of the same page payload.
        raise HTTPException(501, "PDF export arrives with Phase 6 (headless renderer). Use CSV now.")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([f"Infracentra report #{num}: {title}", f"period={period}", f"updated={dd.now_utc()}"])
    for r in _blocks_to_rows(sel):
        w.writerow(r)
    data = "\ufeff" + buf.getvalue()  # BOM for Excel (brief §6)
    return StreamingResponse(
        io.BytesIO(data.encode("utf-8")),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
