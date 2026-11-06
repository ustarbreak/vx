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
import hashlib
import io
import os
import re
import zipfile
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi.responses import StreamingResponse

from app.core.security import get_current_user
from app.core.platform_rbac import has_permission, is_platform_role
from app.database import get_db
from app.models import User, Organization
from app.models_reporting import RptExportLog
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


async def _tenant_id(user: User, requested_org: int | None, db: AsyncSession) -> str:
    if requested_org is not None:
        if not is_platform_role(user.role):
            if user.org_id != requested_org:
                raise HTTPException(403, "Cross-tenant report access denied")
        elif not await has_permission(user, "platform.reports.read", db, org_id=requested_org):
            raise HTTPException(403, "Platform report permission required for this tenant")
        if await db.get(Organization, requested_org) is None:
            raise HTTPException(404, "Report tenant not found")
        return str(requested_org)
    if user.org_id is not None:
        return str(user.org_id)
    if is_platform_role(user.role):
        raise HTTPException(422, "org_id is required when a platform user requests tenant reports")
    raise HTTPException(403, "No tenant scope is available for reporting")


async def _real_pages(report_key: str, tenant: str, period: str) -> list | None:
    """Build from the unified reporting fact schema. No demo fallback."""
    try:
        from app.services.reporting import builders
        return await builders.build(report_key, tenant, period)
    except Exception:
        import logging
        logging.getLogger("infracentra.reporting").exception(
            "report builder failed: report=%s tenant=%s period=%s", report_key, tenant, period
        )
        return None


def _unavailable_pages(report_key: str) -> list:
    num, title, fam, total = BY_KEY[report_key]
    note = ("Donnee indisponible — aucun adaptateur de données réelles n'est "
            "branché pour ce rapport (Phase 2). Le mode démo reste disponible "
            "côté interface.")
    return [[f"Page {i + 1} / {total}", title, [["M", "Source status", [[note, "w"]]]]]
            for i in range(total)]


def _resolve_demo(demo_param: int, demo_source: str) -> bool:
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


def _source_status(pages: list, demo: bool) -> str:
    if demo:
        return "demo"
    rendered = repr(pages).lower()
    if "indisponible" in rendered or "non disponible" in rendered or "non mesuré" in rendered:
        return "partial_or_unavailable"
    return "live"


async def _render_pages(report_key: str, tenant: str, period: str, demo: bool) -> list:
    if demo:
        return dd.build_demo_report(report_key, tenant, period)
    real = await _real_pages(report_key, tenant, period)
    if real is not None:
        ts = dd.now_utc()
        return [[t, f"{intro} · last updated {ts}", b] for t, intro, b in real]
    return _unavailable_pages(report_key)


@router.get("")
async def catalogue(period: str = Query(...), demo: int = Query(0), demo_source: str = Query(""),
                    org_id: int | None = Query(None), current_user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    _check_period(period)
    tenant = await _tenant_id(current_user, org_id, db)
    families = [{"id": fid, "name": fname, "reports": []} for fid, fname in dd.FAMILIES]
    idx = {f["id"]: f for f in families}
    for num, key, title, fam, pages in dd.REPORTS:
        idx[fam]["reports"].append({"number": num, "id": key, "title": title, "pages": pages,
                                    "download_levels": ["page", "report", "family", "all"]})
    return {"demo": _resolve_demo(demo, demo_source), "tenant_id": tenant,
            "total_pages": sum(r[4] for r in dd.REPORTS), "families": families,
            "family_names": dict(dd.FAMILIES)}


@router.get("/bundle")
async def export_bundle(scope: str = Query("all", pattern="^(all|family)$"),
                        family: str | None = Query(None), period: str = Query(...),
                        org_id: int | None = Query(None), demo: int = Query(0),
                        current_user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    tenant = await _tenant_id(current_user, org_id, db)
    _check_period(period)
    if scope == "family" and family not in {fid for fid, _ in dd.FAMILIES}:
        raise HTTPException(422, "A valid family is required for family export")
    selected = [r for r in dd.REPORTS if scope == "all" or r[3] == family]
    use_demo = _resolve_demo(demo, "")
    output = io.BytesIO()
    manifest = []
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for num, key, title, fam, total in selected:
            pages = await _render_pages(key, tenant, period, use_demo)
            buf = io.StringIO()
            writer = csv.writer(buf)
            writer.writerow(["Infracentra report #" + str(num) + ": " + title, "period=" + period, "tenant=" + tenant])
            writer.writerows(_blocks_to_rows(pages))
            payload = ("\ufeff" + buf.getvalue()).encode("utf-8")
            archive.writestr(fam + "/report" + str(num).zfill(2) + "_" + key + "_" + period + ".csv", payload)
            manifest.append({"number": num, "id": key, "family": fam, "pages": total})
            if not use_demo:
                db.add(RptExportLog(tenant_id=tenant, user_id=str(current_user.id), report_id=key,
                    period=period, fmt="csv", sha256=hashlib.sha256(payload).hexdigest(),
                    exported_at=datetime.now(timezone.utc)))
        archive.writestr("manifest.json", __import__("json").dumps(
            {"tenant_id": tenant, "period": period, "scope": scope, "family": family,
             "reports": manifest}, ensure_ascii=False, indent=2))
    if not use_demo:
        await db.commit()
    output.seek(0)
    filename = "infracentra_" + scope + "_" + (family or "all") + "_" + period + ".zip"
    return StreamingResponse(output, media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="' + filename + '"'})


@router.get("/{report_id}")
async def report_pages(report_id: str, period: str = Query(...), demo: int = Query(0),
                       demo_source: str = Query(""), org_id: int | None = Query(None),
                       current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if report_id not in BY_KEY:
        raise HTTPException(404, "Unknown report")
    _check_period(period)
    tenant = await _tenant_id(current_user, org_id, db)
    num, title, fam, pages = BY_KEY[report_id]
    use_demo = _resolve_demo(demo, demo_source)
    body = await _render_pages(report_id, tenant, period, use_demo)
    return {"number": num, "id": report_id, "title": title, "family": fam,
            "period": period, "demo": use_demo, "tenant_id": tenant,
            "source_status": _source_status(body, use_demo), "pages": body}


@router.get("/{report_id}/pages/{n}")
async def one_page(report_id: str, n: int, period: str = Query(...), demo: int = Query(0),
                   demo_source: str = Query(""), org_id: int | None = Query(None),
                   current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if report_id not in BY_KEY:
        raise HTTPException(404, "Unknown report")
    _check_period(period)
    num, title, fam, total = BY_KEY[report_id]
    if not 1 <= n <= total:
        raise HTTPException(404, f"Report {num} has {total} pages")
    tenant = await _tenant_id(current_user, org_id, db)
    body = await _render_pages(report_id, tenant, period, _resolve_demo(demo, demo_source))
    return {"number": num, "id": report_id, "title": title, "family": fam,
            "period": period, "page_no": n, "page": body[n - 1]}


@meta_router.get("/meta")
async def meta(period: str = Query(...), demo: int = Query(0), demo_source: str = Query(""),
               org_id: int | None = Query(None), current_user: User = Depends(get_current_user),
               db: AsyncSession = Depends(get_db)):
    tenant = await _tenant_id(current_user, org_id, db)
    organization = await db.get(Organization, int(tenant))
    return {"client": organization.name if organization else "Tenant " + tenant,
            "tenant_id": tenant, "period": _check_period(period), "version": "2026.11-p5",
            "classification": "CONFIDENTIAL — Infracentra client report",
            "author": "Infracentra Reporting Engine", "last_updated": dd.now_utc(),
            "demo": _resolve_demo(demo, demo_source)}


@router.post("/{report_id}/refresh")
async def refresh(report_id: str, period: str = Query(...),
                  current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if report_id not in BY_KEY:
        raise HTTPException(404, "Unknown report")
    _check_period(period)
    if current_user.role != "platform_admin":
        raise HTTPException(403, "Only the platform Owner can run the global reporting refresh")
    from app.services.reporting.jobs import job_h_ingest, job_h_kpis, job_j_rollup
    ingestion = await job_h_ingest(db, lookback_hours=48)
    daily = await job_h_kpis(db)
    monthly = await job_j_rollup(db, period=period)
    return {"status": "completed", "report": report_id, "period": period,
            "ingestion": ingestion, "daily_kpis": daily, "monthly_rollup": monthly}


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
async def export(report_id: str, format: str = Query("csv", pattern="^(csv|pdf)$"),
                 page: int = Query(0, ge=0), period: str = Query(...), demo: int = Query(0),
                 org_id: int | None = Query(None), current_user: User = Depends(get_current_user),
                 db: AsyncSession = Depends(get_db)):
    if report_id not in BY_KEY:
        raise HTTPException(404, "Unknown report")
    _check_period(period)
    tenant = await _tenant_id(current_user, org_id, db)
    num, title, fam, total = BY_KEY[report_id]
    if page > total:
        raise HTTPException(404, f"Report {num} has {total} pages")
    use_demo = _resolve_demo(demo, "")
    pages = await _render_pages(report_id, tenant, period, use_demo)
    selected = [pages[page - 1]] if page else pages
    suffix = "_p" + str(page) if page else ""
    filename = "report" + str(num).zfill(2) + suffix + "_" + period + "." + format
    if format == "pdf":
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
        from xml.sax.saxutils import escape
        pdf = io.BytesIO()
        doc = SimpleDocTemplate(pdf, pagesize=landscape(A4), rightMargin=12*mm,
                                leftMargin=12*mm, topMargin=12*mm, bottomMargin=12*mm)
        styles = getSampleStyleSheet()
        story = [Paragraph(escape("Infracentra — " + title), styles["Title"]),
                 Paragraph(escape("Tenant " + tenant + " · " + period + (" · DEMO" if use_demo else " · LIVE / source-qualified")), styles["Normal"]),
                 Spacer(1, 8*mm)]
        for index, item in enumerate(selected):
            section, intro, blocks = item
            story.append(Paragraph(escape(str(section)), styles["Heading2"]))
            story.append(Paragraph(escape(str(intro)), styles["BodyText"]))
            rows = _blocks_to_rows([(section, intro, blocks)])
            table_data = [[Paragraph(escape(str(cell)), styles["BodyText"]) for cell in row] for row in rows]
            if table_data:
                table = Table(table_data, repeatRows=1, colWidths=[45*mm, 28*mm, 45*mm, 45*mm, 45*mm, 45*mm])
                table.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#dce7ef")),
                    ("GRID",(0,0),(-1,-1),0.25,colors.HexColor("#9aa8b5")),
                    ("VALIGN",(0,0),(-1,-1),"TOP"),("FONTSIZE",(0,0),(-1,-1),7)]))
                story.extend([Spacer(1, 3*mm), table])
            if index < len(selected)-1:
                story.append(PageBreak())
        doc.build(story)
        payload = pdf.getvalue()
        media_type = "application/pdf"
    else:
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["Infracentra report #" + str(num) + ": " + title, "period=" + period,
                         "tenant=" + tenant, "updated=" + str(dd.now_utc())])
        writer.writerows(_blocks_to_rows(selected))
        payload = ("\ufeff" + buf.getvalue()).encode("utf-8")
        media_type = "text/csv; charset=utf-8"
    if not use_demo:
        db.add(RptExportLog(tenant_id=tenant, user_id=str(current_user.id), report_id=report_id,
            period=period, fmt=format, sha256=hashlib.sha256(payload).hexdigest(),
            exported_at=datetime.now(timezone.utc)))
        await db.commit()
    return StreamingResponse(io.BytesIO(payload), media_type=media_type,
        headers={"Content-Disposition": 'attachment; filename="' + filename + '"'})
