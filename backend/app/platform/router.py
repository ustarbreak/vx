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
from pydantic import BaseModel

from app.core.security import get_current_user
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
    """Honest capability list: ga | beta | roadmap | unsupported per action."""
    specs = load_catalog()
    out = []
    for sid, spec in sorted(specs.items()):
        out.append({
            "service": sid,
            "status": spec.status,
            "provider": spec.provider,
            "actions": [{"name": a.name, "dangerous": a.dangerous, "status": a.status}
                        for a in spec.actions],
        })
    return {"org_id": org_id if org_id is not None else user.org_id, "services": out}


class ActionRequest(BaseModel):
    service: str
    action: str
    payload: dict = {}
    dry_run: bool = True


@router.post("/actions")
async def platform_action(body: ActionRequest, request: Request,
                          user: User = Depends(get_current_user)):
    """Canonical action adapter (T2.6). Phase-1 behavior: validate against the
    catalog and report honestly. Actual delegation to engines lands in
    Phase 2 (T2.7) behind provider_mode=native — until then nothing executes,
    which is the safe default the brief's honesty rule requires."""
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
    if act.dangerous and body.dry_run is False:
        return {"status": "blocked", "reason": "dry-run required until four-eyes gating (T2.5)"}
    return {"status": "queued", "note": "executor wiring scheduled at T2.7", "echo": body.payload}


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
