"""T1.3 / T2.6 — Platform catalog router (additive; never touches existing routes).

Mounted ONLY when settings.PLATFORM_CATALOG_ENABLED is true (default false), so
today's app behavior is unchanged unless explicitly opted in.

Endpoints:
  GET  /api/platform/graph            -> nodes+edges from the YAML catalog
  GET  /api/platform/graph?format=mermaid -> same graph as Mermaid text
  GET  /api/platform/capabilities     -> canonical actions per service, honest status
  POST /api/platform/actions          -> thin adapter: maps canonical action to an
         existing engine route by delegation (owner decision #6: no backend
         rewrite). Unknown/undeployed actions return status "unsupported".
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.core.security import get_current_user
from app.database import get_db
from app.models import AuditLog, User
from app.platform.catalog.schema import load_catalog

logger = logging.getLogger("platform.catalog")

router = APIRouter(prefix="/platform", tags=["Platform Catalog"])


@router.get("/graph")
async def platform_graph(
    request: Request,
    format: str = Query("json", pattern="^(json|mermaid)$"),
    user: User = Depends(get_current_user),
):
    specs = load_catalog()
    if format == "mermaid":
        lines = ["graph TD"]
        for sid, spec in sorted(specs.items()):
            label = f"{spec.name} [{spec.status}/{spec.provider}]"
            lines.append(f'    {sid.replace("-", "_")}["{label}"]')
            for dep in spec.dependencies:
                lines.append(f"    {dep.requires.replace('-', '_')} --> {sid.replace('-', '_')}")
        return {"content_type": "text/plain", "mermaid": "\n".join(lines)}

    nodes = [
        {
            "id": sid,
            "name": spec.name,
            "status": spec.status,
            "provider": spec.provider,
            "engine": spec.engine,
            "in_seed": spec.in_seed,
        }
        for sid, spec in sorted(specs.items())
    ]
    edges = [
        {"from": dep.requires, "to": sid, "rationale": dep.rationale}
        for sid, spec in sorted(specs.items())
        for dep in spec.dependencies
    ]
    await _audit(request, user, "platform.graph.read", "/api/platform/graph")
    return {"nodes": nodes, "edges": edges, "count": len(nodes)}


@router.get("/capabilities")
async def platform_capabilities(
    org_id: Optional[int] = None,
    user: User = Depends(get_current_user),
):
    """Honest capability list: ga | beta | roadmap | unsupported per action.

    Also reports which connector providers have CODE shipped in the SDK
    (app/platform/connectors/providers/) — code existing does NOT mean the
    engine is deployed; deployment status stays on /api/services/{id}/status.
    """
    from app.platform.connectors import providers as _  # noqa: F401  (populate registry)
    from app.platform.connectors.base import _REGISTRY

    coded = {}
    for cls in _REGISTRY.values():
        m = getattr(cls, "manifest", None)
        if m:
            coded.setdefault(m.service_id, []).append(m.id)

    specs = load_catalog()
    out = []
    for sid, spec in sorted(specs.items()):
        out.append({
            "service": sid,
            "status": spec.status,
            "provider": spec.provider,
            "connector_code_shipped": sorted(coded.get(sid, [])),
            "actions": [{"name": a.name, "dangerous": a.dangerous, "status": a.status}
                        for a in spec.actions],
        })
    return {"org_id": org_id if org_id is not None else user.org_id, "services": out}


class ActionRequest(BaseModel):
    service: str
    action: str
    payload: dict = {}
    dry_run: bool = True
    confirm: bool = False


@router.post("/actions")
async def platform_action(body: ActionRequest, request: Request,
                          user: User = Depends(get_current_user),
                          db=Depends(get_db)):
    """Canonical action adapter (T2.6, owner decision #6: thin delegation only).

    Validates against the YAML catalog, then — when settings.PROVIDER_MODE ==
    "native" — delegates to the SAME engine functions the native routes use
    (ticketing.create_ticket / incidents / soar). Anything without a native
    executor reports "unsupported" honestly; nothing is ever faked."""
    from app.core.config import settings
    from app.platform.native_actions import execute_native

    specs = load_catalog()
    spec = specs.get(body.service)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"unknown service {body.service!r}")
    act = next((a for a in spec.actions if a.name == body.action), None)
    if act is None or act.status in ("roadmap", "unsupported"):
        await _audit(request, user, "platform.action.unsupported",
                     f"/api/platform/actions:{body.service}.{body.action}")
        return {"status": "unsupported", "service": body.service, "action": body.action,
                "reason": "no deployed connector/native executor registered yet"}
    if act.dangerous and body.dry_run is False and not body.confirm:
        await _audit(request, user, "platform.action.blocked",
                     f"/api/platform/actions:{body.service}.{body.action}")
        return {"status": "requires_confirmation",
                "reason": "dangerous action: resend with dry_run=false AND confirm=true "
                          "(four-eyes gating stays inside the SOAR engine)"}
    if settings.PROVIDER_MODE != "native":
        return {"status": "queued",
                "note": f"PROVIDER_MODE={settings.PROVIDER_MODE!r}: native delegation disabled",
                "echo": body.payload}
    status_code, result = await execute_native(
        db, user, body.action, body.payload, body.dry_run, body.confirm)
    await _audit(request, user, f"platform.action.{result.get('status', 'unknown')}",
                 f"/api/platform/actions:{body.service}.{body.action}")
    result.setdefault("service", body.service)
    result.setdefault("action", body.action)
    return JSONResponse(status_code=status_code, content=result)


async def _audit(request: Request, user: User, action: str, resource: str) -> None:
    try:
        db = request.state.db if hasattr(request.state, "db") else None
        if db is None:
            return  # best-effort; audit session wiring finalized with T2.4
        db.add(AuditLog(actor_id=user.id, actor_name=user.name, actor_role=user.role,
                        org_id=user.org_id, action=action, resource=resource,
                        resource_id="-", details=None,
                        ip_address=request.client.host if request.client else None,
                        outcome="success"))
        await db.commit()
    except Exception as exc:  # noqa: BLE001 — audit must never break reads
        logger.warning("platform audit write failed: %s", exc)


# ---------------------------------------------------------------------------
# T4.2 — onboarding lifecycle (mounted only with PLATFORM_CATALOG_ENABLED;
# writes also require SERVICE_LIFECYCLE_ENABLED so the two flags stay honest).
# ---------------------------------------------------------------------------

@router.get("/lifecycle")
async def platform_lifecycle(request: Request, user: User = Depends(get_current_user),
                             db=Depends(get_db)):
    """Per-org checklist state for every catalog service."""
    from app.core.config import settings
    from app.platform import lifecycle
    from app.models import ServiceLifecycleState
    from sqlalchemy import select
    if not settings.SERVICE_LIFECYCLE_ENABLED:
        return {"enabled": False, "services": []}
    rows = (await db.execute(
        select(ServiceLifecycleState).where(ServiceLifecycleState.org_id == user.org_id)
    )).scalars().all()
    known = {r.service_id for r in rows}
    items = [lifecycle.as_dict(r) for r in sorted(rows, key=lambda r: r.service_id)]
    for sid in load_catalog():
        if sid not in known:
            items.append({"service_id": sid, "state": "not_installed",
                          "installed_at": None, "connected_at": None,
                          "first_success_at": None})
    return {"enabled": True, "org_id": user.org_id, "services": items}


class FirstSuccessRequest(BaseModel):
    note: str = ""


@router.post("/services/{service_id}/first-success")
async def platform_first_success(service_id: str, body: FirstSuccessRequest,
                                 request: Request,
                                 user: User = Depends(get_current_user),
                                 db=Depends(get_db)):
    """Record the brief's 'first success' milestone after deploy/<engine>/verify.sh
    passes. Idempotent; refuses unknown services and stays disabled without the
    lifecycle flag."""
    from app.core.config import settings
    from app.platform import lifecycle
    if service_id not in load_catalog():
        raise HTTPException(status_code=404, detail=f"unknown service {service_id!r}")
    if not settings.SERVICE_LIFECYCLE_ENABLED:
        raise HTTPException(status_code=409,
                            detail="SERVICE_LIFECYCLE_ENABLED=false; enable to record milestones")
    row = await lifecycle.advance(db, user.org_id, service_id, "first_success")
    await _audit(request, user, "platform.lifecycle.first_success",
                 f"/api/platform/services/{service_id}/first-success")
    return {"status": "ok", **lifecycle.as_dict(row), "note": body.note[:500]}
