"""Service entitlement dependency graph (backend source of truth).

Single canonical table of platform service-dependency edges, mirrored by
src/data/serviceDependencies.ts on the frontend. The graph is built ONLY from
rows that genuinely exist in the database for the caller's organization:

  * nodes    = Entitlement rows (org_id scoped) — a service appears in the
               graph only when the tenant has an entitlement record for it.
  * overlays = TenantServiceGrant rows (platform overrides beyond the plan)
               and PlanEntitlementV2 rows (pack composition per plan tier).
  * edges    = SERVICE_DEPENDENCY_RULES below, rendered only when BOTH
               endpoints have entitlement records. A rule whose upstream is
               NOT entitled is surfaced honestly as a "missing dependency"
               (`provisioned: false`) instead of being hidden or faked.

The API never claims operational health from entitlement presence alone —
`status` here reflects the provisioning record (enabled/disabled), nothing more.
"""
from __future__ import annotations

from typing import Any, Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Entitlement, Organization, PlanEntitlementV2, TenantServiceGrant

# ---------------------------------------------------------------------------
# Declared dependency rules — canonical copy mirrored in
# src/data/serviceDependencies.ts (§6F). Keys are service ids from
# serviceCatalog (src/data/mockData.ts) / seed ALL_SERVICES.
# ---------------------------------------------------------------------------
SERVICE_DEPENDENCY_RULES: List[Dict[str, Any]] = [
    {"service": "analytics", "requires": "network-monitoring",
     "rationale": "Le flux d'événements analysés par Security Analytics provient des collecteurs Network Monitoring (NMS)."},
    {"service": "threat-intel", "requires": "analytics",
     "rationale": "Les correspondances IoC ⇄ événements sont calculées sur le pipeline de détection de Security Analytics."},
    {"service": "incident-response", "requires": "analytics",
     "rationale": "Les alertes corrélées par Security Analytics alimentent la file de qualification d'Incident Response."},
    {"service": "soar", "requires": "incident-response",
     "rationale": "Les playbooks SOAR se déclenchent sur un incident qualifié et écrivent leur résultat dans le dossier IR."},
    {"service": "soar", "requires": "threat-intel",
     "rationale": "L'enrichissement des steps SOAR (réputation, blocage) consomme les indicateurs Threat Intelligence."},
    {"service": "endpoint-protection", "requires": "analytics",
     "rationale": "Les événements EDR/XDR remontent au pipeline SIEM pour corrélation avec les autres sources."},
    {"service": "email-security", "requires": "threat-intel",
     "rationale": "Le filtrage des liens/pièces jointes compare les extraits aux indicateurs Threat Intelligence."},
    {"service": "dns-filtering", "requires": "threat-intel",
     "rationale": "La liste de blocage DNS est distribuée depuis les flux Threat Intelligence (canaux autorisés)."},
    {"service": "firewall-mgmt", "requires": "threat-intel",
     "rationale": "Les règles de blocage IP poussées par Firewall Management ciblent des adresses signalées par Threat Intel."},
    {"service": "cloud-security", "requires": "asset-discovery",
     "rationale": "Le posture CSPM évalue uniquement les ressources identifiées par la découverte d'actifs."},
    {"service": "vuln-scanning", "requires": "asset-discovery",
     "rationale": "Le scanneur cible l'inventaire produit par la découverte automatique ; hors inventaire = hors périmètre."},
    {"service": "patch-management", "requires": "vuln-scanning",
     "rationale": "Les déploiements de correctifs sont priorisés par les vulnérabilités confirmées du Vulnerability Scanning."},
    {"service": "backup-dr", "requires": "cloud-security",
     "rationale": "Les politiques de sauvegarde DR s'appliquent aux charges de travail déclarées par le posture Cloud."},
    {"service": "compliance", "requires": "analytics",
     "rationale": "Les preuves de contrôle (journaux conservés, temps de réponse) sont tirées des données Security Analytics."},
]

# Human-readable labels (white-label category names, no vendor brands).
SERVICE_LABELS: Dict[str, str] = {
    "threat-intel": "Threat Intelligence",
    "compliance": "Compliance Mapper",
    "incident-response": "Incident Response",
    "analytics": "Security Analytics",
    "soar": "SOAR Automation",
    "vuln-scanning": "Vulnerability Scanning",
    "patch-management": "Patch Management",
    "backup-dr": "Backup & Disaster Recovery",
    "endpoint-protection": "Endpoint Protection (EDR/XDR)",
    "email-security": "Email Security",
    "cloud-security": "Cloud Security Posture (CSPM)",
    "network-monitoring": "Network Monitoring (NMS)",
    "dns-filtering": "DNS Filtering",
    "firewall-mgmt": "Firewall Management",
    "vpn-gateway": "Managed VPN Gateway",
    "sd-wan": "SD-WAN",
    "asset-discovery": "Asset Discovery",
    "advanced-ticketing": "Advanced Ticketing",
}

SERVICE_CATEGORY: Dict[str, str] = {
    "threat-intel": "security", "compliance": "security", "incident-response": "security",
    "analytics": "security", "soar": "security",
    "vuln-scanning": "psa", "patch-management": "psa", "backup-dr": "psa",
    "endpoint-protection": "psa", "email-security": "psa", "cloud-security": "psa",
    "network-monitoring": "networking", "dns-filtering": "networking",
    "firewall-mgmt": "networking", "vpn-gateway": "networking", "sd-wan": "networking",
    "asset-discovery": "networking", "advanced-ticketing": "psa",
}


async def build_service_graph(db: AsyncSession, org_id: int) -> Dict[str, Any]:
    """Assemble the tenant-facing dependency graph strictly from persisted rows."""
    org = (await db.execute(select(Organization).where(Organization.id == org_id))).scalar_one_or_none()
    if not org:
        return {"error": "organization_not_found"}

    ent_rows = (await db.execute(
        select(Entitlement).where(Entitlement.org_id == org_id)
    )).scalars().all()
    grant_rows = (await db.execute(
        select(TenantServiceGrant).where(TenantServiceGrant.org_id == org_id)
    )).scalars().all()
    grants = {g.service_id: g for g in grant_rows}

    plan = (org.plan_tier or "STARTER").lower()
    plan_services = set((await db.execute(
        select(PlanEntitlementV2.service_id).where(
            PlanEntitlementV2.plan == plan, PlanEntitlementV2.included.is_(True))
    )).scalars().all())

    # Node set = every service with an entitlement RECORD for this org
    # (enabled or not — disabled rows render grey, they are not hidden).
    nodes_map: Dict[str, Dict[str, Any]] = {}
    for e in ent_rows:
        g = grants.get(e.service_id)
        nodes_map[e.service_id] = {
            "id": e.service_id,
            "label": SERVICE_LABELS.get(e.service_id, e.service_id),
            "category": SERVICE_CATEGORY.get(e.service_id, "other"),
            "status": "enabled" if e.enabled else "disabled",
            "seat_count": e.seat_count or 0,
            "in_plan": e.service_id in plan_services,
            "override": bool(g.override_plan) if g else False,
            "grant_enabled": (g.enabled if g else None),
            "activated_at": e.activated_at.isoformat() if e.activated_at else None,
        }
    # Grants without an entitlement row still count as provisioned records.
    for sid, g in grants.items():
        if sid not in nodes_map:
            nodes_map[sid] = {
                "id": sid, "label": SERVICE_LABELS.get(sid, sid),
                "category": SERVICE_CATEGORY.get(sid, "other"),
                "status": "enabled" if g.enabled else "disabled",
                "seat_count": 0, "in_plan": sid in plan_services,
                "override": bool(g.override_plan), "grant_enabled": g.enabled,
                "activated_at": None,
            }

    present = set(nodes_map)
    edges: List[Dict[str, Any]] = []
    missing: List[Dict[str, Any]] = []
    for rule in SERVICE_DEPENDENCY_RULES:
        svc, up = rule["service"], rule["requires"]
        if svc not in present:
            continue  # dependent service itself not provisioned → no node, no edge
        if up in present:
            edges.append({
                "from": up, "to": svc,
                "kind": "declared",
                "provisioned": True,
                "upstream_status": nodes_map[up]["status"],
                "rationale": rule["rationale"],
            })
        else:
            missing.append({
                "from": up, "to": svc,
                "kind": "declared",
                "provisioned": False,
                "upstream_label": SERVICE_LABELS.get(up, up),
                "rationale": rule["rationale"],
            })

    downstream: Dict[str, List[str]] = {}
    for e in edges:
        downstream.setdefault(e["from"], []).append(e["to"])

    return {
        "org": {"id": org.id, "name": org.name, "plan": plan, "trial": bool(org.trial)},
        "nodes": list(nodes_map.values()),
        "edges": edges,
        "missing_dependencies": missing,
        "downstream_index": downstream,
        "counts": {
            "services_total": len(nodes_map),
            "services_enabled": sum(1 for n in nodes_map.values() if n["status"] == "enabled"),
            "edges_shown": len(edges),
            "missing_dependencies": len(missing),
        },
        "disclaimer": ("Vue déclarative basée sur les lignes d'entitlements persistées — "
                       "aucune télémétrie temps réel ; la présence d'un entitlement "
                       "n'affirme jamais une santé opérationnelle."),
    }
