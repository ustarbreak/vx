"""INFRAvx — Pricing engine v2 (PURE, decimal arithmetic, ROUND_HALF_UP).

Mirror of src/services/pricingEngine.ts — identical logic, identical results.
Golden fixtures: tests/fixtures/pricing_golden.json must pass in BOTH engines.

Rules recap (docs/pricing/README.md):
  units = Σ qty × weight (heavy 1.0 / light 0.5)
  pack eligibility strict (never bill below the minimum)
  volume discount: direct clients only; partner tier replaces it
  partner groups: per-asset d, storage max(0.10, d−0.10), SOC flat 0.15,
  contract applied AFTER partner discount with a global 40% cap off list.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

D = Decimal
CENT = D("0.01")


def r2(x: Decimal) -> Decimal:
    return x.quantize(CENT, rounding=ROUND_HALF_UP)


def load_config(path: Optional[str] = None) -> Dict[str, Any]:
    """Load the versioned pricing config JSON (single source of truth)."""
    if path is None:
        import os
        here = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(here, "..", "core", "pricing_config.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


PRICING_CONFIG = load_config()


# --------------------------------------------------------------------------- #
# Primitives
# --------------------------------------------------------------------------- #
def billable_units(cfg: Dict[str, Any], assets: List[Dict[str, Any]]) -> Decimal:
    total = D(0)
    for a in assets:
        w = D(str(cfg["assetClasses"].get(a["class"], 1)))
        total += D(str(a["qty"])) * w
    return total


def graduated_cost_mad(cfg: Dict[str, Any], gb: Decimal) -> Decimal:
    """Cumulative graduated SIEM cost for `gb` GB/day (MAD, 2 decimals)."""
    rem = D(gb)
    total = D(0)
    prev_cap = D(0)
    for cap, rate in cfg["siem"]["graduatedRatesPerGbDay"]:
        if rem <= 0:
            break
        width = D("Infinity") if cap is None else D(str(cap)) - prev_cap
        take = rem if width == D("Infinity") or rem < width else width
        total += take * D(str(rate))
        rem -= take
        if cap is not None:
            prev_cap = D(str(cap))
    return r2(total)


def volume_rate(cfg: Dict[str, Any], units: Decimal) -> Decimal:
    for mn, rate in sorted(cfg["volumeDiscount"], key=lambda x: -x[0]):
        if units >= D(str(mn)):
            return D(str(rate))
    return D(0)


def included_siem(cfg: Dict[str, Any], pack: Optional[str], units: Decimal) -> Decimal:
    if not pack or pack == "custom":
        return D(0)
    q = cfg["packs"][pack]["siemQuota"]
    return max(D(str(q["min"])), units * D(str(q["perUnit"])))


def partner_tier_for(cfg: Dict[str, Any], managed_units: Decimal) -> Dict[str, Any]:
    t = cfg["partner"]["tiers"][0]
    for x in cfg["partner"]["tiers"]:
        if managed_units >= D(str(x["minManagedUnits"])):
            t = x
    return t


# --------------------------------------------------------------------------- #
# Quote
# --------------------------------------------------------------------------- #
def quote(inputs: Dict[str, Any], cfg: Dict[str, Any] = PRICING_CONFIG) -> Dict[str, Any]:
    return _quote_core(inputs, cfg, with_recommendation=True)


def _quote_core(inputs: Dict[str, Any], cfg: Dict[str, Any], with_recommendation: bool = True) -> Dict[str, Any]:
    mode = inputs.get("mode", "pack")
    upsell: List[str] = []
    assets = inputs.get("assets", [])
    units = billable_units(cfg, assets)
    physical = sum(D(str(a["qty"])) for a in assets)
    contract = int(inputs.get("contractMonths", 0) or 0)
    c_rate = D(str(cfg["contractDiscount"].get(str(contract), 0)))
    partner_tier_id = inputs.get("partnerTier")
    is_partner = bool(partner_tier_id)
    tier_def = None
    if is_partner:
        tier_def = next((t for t in cfg["partner"]["tiers"] if t["id"] == partner_tier_id), cfg["partner"]["tiers"][0])

    deal_bonus = D(0)
    if is_partner and inputs.get("dealRegisteredAt"):
        try:
            reg = datetime.fromisoformat(str(inputs["dealRegisteredAt"]).replace("Z", "+00:00"))
            age_days = (datetime.now(timezone.utc) - reg).days
            if age_days <= cfg["partner"]["dealRegistrationBonus"]["months"] * 31:
                deal_bonus = D(str(cfg["partner"]["dealRegistrationBonus"]["points"]))
        except Exception:
            pass

    def _ineligible(reason: str) -> Dict[str, Any]:
        return {
            "eligible": False, "reason": reason, "config_version": cfg["version"],
            "mode": mode, "pack": inputs.get("pack") or "custom",
            "lines": [], "totals": {"units": float(units)}, "upsell_notes": upsell,
        }

    price_per_unit = D(0)
    pack_name = ""
    included = D(0)
    support_included_247 = False
    starter_intro_active = False

    if mode == "pack":
        p = inputs["pack"]
        pack_name = p
        dfn = cfg["packs"][p]
        min_u, max_u = D(str(dfn["minUnits"])), (None if dfn["maxUnits"] is None else D(str(dfn["maxUnits"])))
        if units < min_u:
            return _ineligible(f"{p.capitalize()} commence à {dfn['minUnits']} unités ; ce parc en fait {fmt_u(units)}.")
        if max_u is not None and units > max_u:
            nxt = " Choisissez Pro." if p == "starter" else ""
            return _ineligible(f"{p.capitalize()} est limité à {dfn['maxUnits']} unités ; ce parc en fait {fmt_u(units)}.{nxt}")
        if inputs.get("support247") and p == "starter":
            return _ineligible("Le support 24/7 n'est pas disponible avec Starter — choisissez Pro.")
        support_included_247 = (p == "souverain")
        price = D(str(dfn["price"]))
        promo = cfg["promotions"]["starterIntro"]
        if p == "starter" and promo["enabled"] and contract <= promo["months"]:
            price = D(str(promo["price"]))
            starter_intro_active = True
        price_per_unit = price
        included = included_siem(cfg, p, units)
    else:
        if units < D(str(cfg["custom"]["minUnits"])):
            return _ineligible(f"Un plan sur mesure demande au moins {cfg['custom']['minUnits']} unités.")
        svc_ids = inputs.get("customServices") or []
        paid = [s for s in cfg["services"] if s["id"] in svc_ids]
        cumulative = D(str(cfg["custom"]["platformBase"])) + sum(D(str(s["price"])) for s in paid)
        th = [D(str(t)) for t in cfg["custom"]["unlockThresholds"]]
        slots = 3 if cumulative >= th[2] else 2 if cumulative >= th[1] else 1 if cumulative >= th[0] else 0
        picks = [x for x in (inputs.get("freePicks") or []) if x != "ticketing" or slots >= 3]
        # Slot allocation follows the config tick order of freePool (dns, analytics,
        # threat_intel); ticketing is only ever free at the top threshold.
        pool_order = [f["id"] for f in cfg["freePool"] if not f.get("topTierOnly")]
        # Best-for-client allocation: the most valuable requested gifts fill the
        # slots first; the rest are billed at list price. Ticketing is only ever
        # free at the top threshold (topTierOnly).
        requested = sorted((x for x in picks if x in pool_order),
                           key=lambda i: next(f["listPrice"] for f in cfg["freePool"] if f["id"] == i),
                           reverse=True)
        billed_free = requested[slots:]
        billed_list = sum((D(str(f["listPrice"])) for f in cfg["freePool"] if f["id"] in billed_free), D(0))
        price_per_unit = max(D(str(cfg["custom"]["floor"])), cumulative + billed_list)
        included = D(0)
        if slots < 3:
            need = th[slots] - cumulative
            if need > 0:
                upsell.append(f"Ajoutez {int(need)} MAD/actif de services pour débloquer un service offert supplémentaire.")

    lines: List[Dict[str, Any]] = []
    asset_lines: List[Decimal] = []   # MAD amounts (positive)
    storage_lines: List[Decimal] = []
    soc_lines: List[Decimal] = []

    assets_amt = r2(units * price_per_unit)
    label_extra = " (tarif de lancement)" if starter_intro_active else ""
    lines.append({"key": "assets", "label_fr": f"Supervision de {fmt_u(units)} unité(s)-service{label_extra}",
                  "qty": float(units), "unit_mad": float(price_per_unit), "amount_mad": float(assets_amt), "kind": "asset"})
    asset_lines.append(assets_amt)

    if inputs.get("support247"):
        if support_included_247:
            lines.append({"key": "support247", "label_fr": "Support 24/7 — inclus dans le pack", "amount_mad": 0.0, "kind": "info", "note": "included"})
        elif mode == "custom":
            # Custom already prices every selected service per unit; the 24/7
            # on-call is included at no extra charge (Souverain-equivalent rule).
            lines.append({"key": "support247", "label_fr": "Astreinte 24/7 — incluse (plan sur mesure complet)",
                          "amount_mad": 0.0, "kind": "info", "note": "included"})
        else:
            supp = r2(units * D(str(cfg["support247PerUnit"])))
            lines.append({"key": "support247", "label_fr": "Astreinte 24/7 (SOC)", "qty": float(units),
                          "unit_mad": cfg["support247PerUnit"], "amount_mad": float(supp), "kind": "soc247"})
            soc_lines.append(supp)

    req_raw = D(str(inputs.get("siemGbDay") or 0))
    req_gb = max(req_raw, D(str(cfg["siem"]["minGbPerDay"]))) if req_raw > 0 else D(0)
    if req_gb > 0:
        charge = graduated_cost_mad(cfg, req_gb) - graduated_cost_mad(cfg, max(included, D(0)))
        if charge > 0:
            charge = r2(charge)
            lines.append({"key": "siem", "label_fr": f"SIEM — {fmt_u(req_gb)} Go/jour (dont {fmt_u(max(included, D(0)))} Go inclus)",
                          "qty": float(req_gb), "amount_mad": float(charge), "kind": "storage"})
            storage_lines.append(charge)
        else:
            lines.append({"key": "siem", "label_fr": f"SIEM — {fmt_u(req_gb)} Go/jour : inclus ({fmt_u(included)} Go)",
                          "amount_mad": 0.0, "kind": "info", "note": "included"})

    ret_sel = int(inputs.get("retentionDays") or 30)
    base_ret = int(cfg["packs"][pack_name]["retentionDays"]) if mode == "pack" else 30
    m_sel = D(str(cfg["siem"]["retentionMultiplier"].get(str(ret_sel), 1)))
    m_base = D(str(cfg["siem"]["retentionMultiplier"].get(str(base_ret), 1)))
    if m_sel > m_base and req_gb > 0:
        eff = max(req_gb, included)
        upl = r2(graduated_cost_mad(cfg, eff) * (m_sel - m_base))
        if upl > 0:
            lines.append({"key": "retention", "label_fr": f"Rétention {ret_sel} jours (×{m_sel})", "amount_mad": float(upl), "kind": "storage"})
            storage_lines.append(upl)

    backup_in_scope = True if mode == "pack" else ("backup" in (inputs.get("customServices") or []))
    quota_pu = D(str(cfg["packs"][pack_name]["backupQuotaGbPerUnit"] if mode == "pack" else cfg["custom"]["backupQuotaGbPerUnit"]))
    vol = D(str(inputs.get("backupVolumeGb") or 0))
    if backup_in_scope and vol > 0:
        quota = units * quota_pu
        over = max(D(0), vol - quota)
        blocks = int(math.ceil(float(over) / cfg["backup"]["overageBlockGb"]))
        if blocks > 0:
            amt = r2(D(blocks) * D(str(cfg["backup"]["overagePerBlock"])))
            lines.append({"key": "backup_over", "label_fr": f"Sauvegarde — {fmt_u(over)} Go au-delà du quota ({fmt_u(quota)} Go), {blocks} bloc(s)",
                          "qty": blocks, "unit_mad": cfg["backup"]["overagePerBlock"], "amount_mad": float(amt), "kind": "storage"})
            storage_lines.append(amt)
            if quota > 0 and vol >= quota * D(str(cfg["upsell"]["backupQuotaWarnPct"])):
                upsell.append(f"Sauvegarde proche du quota ({int(vol / quota * 100)} % utilisé).")
        else:
            lines.append({"key": "backup_over", "label_fr": f"Sauvegarde — {fmt_u(vol)} Go dans le quota ({fmt_u(quota)} Go)",
                          "amount_mad": 0.0, "kind": "info", "note": "included"})

    subtotal = sum(asset_lines, D(0)) + sum(storage_lines, D(0)) + sum(soc_lines, D(0))

    volume_disc = D(0)
    if not is_partner and mode == "pack":
        vr = volume_rate(cfg, units)
        if vr > 0:
            volume_disc = r2(subtotal * vr)
            lines.append({"key": "volume", "label_fr": f"Remise volume ({int(vr * 100)} %) — {fmt_u(units)} unités",
                          "amount_mad": float(-volume_disc), "kind": "discount"})

    A = sum(asset_lines, D(0)); S = sum(storage_lines, D(0)); O = sum(soc_lines, D(0))
    partner_disc = D(0); cap_applied = False
    groups = {"asset": {"list": float(A), "net": 0.0}, "storage": {"list": float(S), "net": 0.0}, "soc": {"list": float(O), "net": 0.0}}

    if is_partner and tier_def:
        d_asset = min(D(1), D(str(tier_def["discount"])) + deal_bonus)
        d_storage = max(D(str(cfg["partner"]["storageLineMinDiscount"])),
                        D(str(tier_def["discount"])) - D(str(cfg["partner"]["storageLineDiscountOffset"])))
        d_soc = D(str(cfg["partner"]["soc247Discount"]))
        cap = D(str(cfg["partner"]["totalDiscountCap"]))

        def netg(list_amt: Decimal, p: Decimal):
            nonlocal cap_applied
            pd_ = r2(list_amt * p)
            after = list_amt - pd_
            raw_net = r2(after * (D(1) - c_rate))
            floor_net = r2(list_amt * (D(1) - cap))
            cd = after - raw_net
            if raw_net < floor_net:
                cap_applied = True
                raw_net = floor_net
                cd = after - raw_net
            return pd_, cd, raw_net, after

        pa, ca, na, ta = netg(A, d_asset)
        ps, cs, ns, ts = netg(S, d_storage)
        po, co, no, to = netg(O, d_soc)
        partner_disc = pa + ps + po
        contract_total = ca + cs + co
        lbl = (f"Remise partenaire {tier_def['id']} ({int(d_asset*100)} % par unité · "
               f"{int(d_storage*100)} % stockage · {int(d_soc*100)} % SOC)")
        if deal_bonus > 0:
            lbl += " + bonus affaire enregistrée"
        lines.append({"key": "partner", "label_fr": lbl, "amount_mad": float(-partner_disc), "kind": "discount"})
        if c_rate > 0:
            note = " — plafond de remise global appliqué" if cap_applied else ""
            lines.append({"key": "contract", "label_fr": f"Remise contrat {contract} mois ({int(c_rate*100)} %){note}",
                          "amount_mad": float(-contract_total), "kind": "discount"})
        recurring = na + ns + no
        groups = {"asset": {"list": float(A), "net": float(na)}, "storage": {"list": float(S), "net": float(ns)}, "soc": {"list": float(O), "net": float(no)}}
    else:
        base_after_vol = subtotal - volume_disc
        contract_total = D(0)
        if c_rate > 0:
            cd = r2(base_after_vol * c_rate)
            lines.append({"key": "contract", "label_fr": f"Remise contrat {contract} mois ({int(c_rate*100)} %)",
                          "amount_mad": float(-cd), "kind": "discount"})
            contract_total = cd
        recurring = base_after_vol - contract_total
        groups = {"asset": {"list": float(A), "net": float(A)}, "storage": {"list": float(S), "net": float(S)}, "soc": {"list": float(O), "net": float(O)}}

    # Onboarding
    onboard = D(0); onb_note = None
    if is_partner:
        onb_note = "Onboarding réalisé par le partenaire — facturation plateforme annulée"
    elif contract >= cfg["onboardingWaivedAtMonths"]:
        onb_note = f"Frais d'onboarding offerts (contrat {contract} mois)"
    else:
        if mode == "pack":
            onboard = D(str(cfg["packs"][pack_name]["onboarding"]))
        else:
            onboard = D(str(cfg["custom"]["onboardingBase"])) + D(str(cfg["custom"]["onboardingPerPaidService"])) * len(inputs.get("customServices") or [])
    if onboard > 0:
        lines.append({"key": "onboarding", "label_fr": "Mise en service (une fois)", "amount_mad": float(onboard), "kind": "onboarding"})
    elif onb_note:
        lines.append({"key": "onboarding", "label_fr": onb_note, "amount_mad": 0.0, "kind": "info"})

    vat = r2(recurring * D(str(cfg["vat"])))
    monthly_incl = r2(recurring + vat)
    lines.append({"key": "vat", "label_fr": f"TVA {int(cfg['vat']*100)} %", "amount_mad": float(vat), "kind": "vat"})

    totals = {
        "units": float(units), "price_per_unit_mad": float(price_per_unit),
        "subtotal_mad": float(r2(subtotal)), "volume_discount_mad": float(volume_disc),
        "contract_discount_mad": float(contract_total), "partner_discount_mad": float(r2(partner_disc)),
        "cap_applied": cap_applied,
        "monthly_excl_vat_mad": float(r2(recurring)), "vat_mad": float(vat), "monthly_incl_vat_mad": float(monthly_incl),
        "annual_excl_vat_mad": float(r2(recurring * 12)), "onboarding_mad": float(onboard),
        "first_year_incl_vat_mad": float(r2(recurring * 12 + vat * 12 + onboard)),
        "effective_per_unit_mad": float(r2(recurring / units)) if units > 0 else 0.0,
        "effective_per_asset_mad": float(r2(recurring / physical)) if physical > 0 else 0.0,
    }

    if mode == "pack" and pack_name == "starter" and units >= D(str(cfg["upsell"]["starterNearCapUnits"])):
        upsell.append(f"Pro démarre à {cfg['packs']['pro']['minUnits']} unités et inclut davantage de services et un quota SIEM.")
    if mode == "pack" and pack_name == "starter" and req_gb > 0 and units >= D(str(cfg["packs"]["pro"]["minUnits"])):
        upsell.append(f"Pro inclut jusqu'à {fmt_u(included_siem(cfg, 'pro', units))} Go/jour de SIEM.")

    return {
        "eligible": True, "config_version": cfg["version"], "mode": mode,
        "pack": pack_name or "custom", "lines": lines, "totals": totals,
        "recommended_pack": recommend_pack(cfg, inputs) if with_recommendation else None, "upsell_notes": upsell,
        "groups": groups if is_partner else None,
    }


def recommend_pack(cfg: Dict[str, Any], inputs: Dict[str, Any]) -> Optional[str]:
    if inputs.get("mode") != "pack":
        return None
    best = None
    for p in cfg["packs"]:
        probe = dict(inputs); probe["pack"] = p
        if p == "starter":
            probe["support247"] = False
        r = _quote_core(probe, cfg, with_recommendation=False)
        if r["eligible"]:
            cost = r["totals"]["monthly_excl_vat_mad"]
            if best is None or cost < best[1]:
                best = (p, cost)
    return best[0] if best else None


def fmt_u(u: Decimal) -> str:
    u = D(u)
    if u == u.to_integral_value():
        return str(int(u))
    return str(u).replace(".", ",")


def partner_margin(resale_per_unit: float, wholesale_per_unit: float) -> Dict[str, Any]:
    m = r2(D(str(resale_per_unit)) - D(str(wholesale_per_unit)))
    return {"per_unit": float(m), "monthly": lambda units: float(r2(m * D(str(units))))}
