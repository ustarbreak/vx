"""Golden pricing fixtures — MUST pass for the Python engine.

The TypeScript mirror (src/services/pricingEngine.ts) is checked by
`npm run test:pricing` (node runner over the same JSON fixture).

Run from repo root:  python tests/test_pricing_golden.py
"""
import json
import os
import sys
from decimal import Decimal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.services.pricing_engine import (  # noqa: E402
    PRICING_CONFIG,
    billable_units,
    partner_tier_for,
    quote,
)

FIXTURES = json.load(open(os.path.join(ROOT, "tests", "fixtures", "pricing_golden.json")))

failures = []


def check(name, got, want):
    if abs(float(got) - float(want)) > 0.011:
        failures.append(f"{name}: got {got}, want {want}")


for case in FIXTURES["cases"]:
    cid = case["id"]
    if cid == "f7_eligibility":
        for i, chk in enumerate(case["checks"]):
            r = quote(chk["inputs"], PRICING_CONFIG)
            if r.get("eligible") != chk["expect_eligible"]:
                failures.append(f"{cid}[{i}]: eligible={r.get('eligible')} want {chk['expect_eligible']} ({r.get('reason')})")
        continue
    if cid == "f7b_partner_tiers":
        for chk in case["checks"]:
            t = partner_tier_for(PRICING_CONFIG, Decimal(str(chk["managed_units"])))
            if t["id"] != chk["tier"]:
                failures.append(f"{cid}: {chk['managed_units']} -> {t['id']} want {chk['tier']}")
        continue
    if cid.startswith("f8"):
        for chk in case.get("checks", []):
            r = quote(chk["inputs"], PRICING_CONFIG)
            if "expect_eligible" in chk and r.get("eligible") != chk["expect_eligible"]:
                failures.append(f"{cid}: eligible={r.get('eligible')} want {chk['expect_eligible']}")
            if chk.get("expect_included_247"):
                line = next((l for l in r.get("lines", []) if l["key"] == "support247"), None)
                if not line or line.get("kind") != "info":
                    failures.append(f"{cid}: 24/7 should be an 'Included' info line, got {line}")
        continue
    if cid.startswith("f9"):
        cfg = PRICING_CONFIG
        for sub in case["cases"]:
            pack = sub["pack"]
            dfn = cfg["packs"][pack]
            heavy = int(dfn["minUnits"])  # exact minimum -> eligible everywhere, no volume discount
            units_assets = [{"class": "server", "qty": heavy}]
            pr = quote({"mode": "pack", "pack": pack, "assets": units_assets, "siemGbDay": 0,
                        "retentionDays": dfn["retentionDays"], "contractMonths": 0}, cfg)
            if not pr["eligible"]:
                failures.append(f"f9/{pack}: pack quote ineligible: {pr.get('reason')}"); continue
            pack_ppu = pr["totals"]["price_per_unit_mad"]
            cust_inputs = {"mode": "custom", "assets": units_assets, "siemGbDay": 0,
                           "retentionDays": 30, "contractMonths": 0,
                           "customServices": sub["custom_services"], "freePicks": sub["free_picks"]}
            if sub.get("support247"):
                cust_inputs["support247"] = True
            cr = quote(cust_inputs, cfg)
            if not cr["eligible"]:
                failures.append(f"f9/{pack}: custom ineligible: {cr.get('reason')}"); continue
            cust_ppu = cr["totals"]["price_per_unit_mad"]
            saving = (cust_ppu - pack_ppu) / cust_ppu * 100.0
            if abs(cust_ppu - sub["custom_best_monthly"]) > 0.01:
                failures.append(f"f9/{pack}: custom ppu {cust_ppu} != derived {sub['custom_best_monthly']}")
            if not (sub["saving_pct_min"] - 0.5 <= saving <= sub["saving_pct_max"] + 0.5):
                failures.append(f"f9/{pack}: saving {saving:.1f}% outside [{sub['saving_pct_min']},{sub['saving_pct_max']}] (custom {cust_ppu} vs pack {pack_ppu})")
            print(f"  f9/{pack}: custom {cust_ppu} vs pack {pack_ppu} -> saving {saving:.1f}%")
        continue
    # standard quote cases (f1..f6)
    if "inputs" not in case: continue
    r = quote(case["inputs"], PRICING_CONFIG)
    if not r.get("eligible"):
        failures.append(f"{cid}: expected eligible, got reason: {r.get('reason')}")
        continue
    t = r["totals"]
    exp = case["expect"]
    check(f"{cid}.units", t["units"], exp.get("units", t["units"]))
    check(f"{cid}.price_per_unit", t["price_per_unit_mad"], exp.get("price_per_unit_mad", t["price_per_unit_mad"]))
    check(f"{cid}.monthly_excl_vat", t["monthly_excl_vat_mad"], exp.get("monthly_excl_vat_mad", t["monthly_excl_vat_mad"]))
    check(f"{cid}.vat", t["vat_mad"], exp.get("vat_mad", t["vat_mad"]))
    check(f"{cid}.monthly_incl_vat", t["monthly_incl_vat_mad"], exp.get("monthly_incl_vat_mad", t["monthly_incl_vat_mad"]))
    check(f"{cid}.onboarding", t["onboarding_mad"], exp.get("onboarding_mad", t["onboarding_mad"]))
    if "assets_line_mad" in exp:
        line = next((l for l in r["lines"] if l["key"] == "assets"), None)
        check(f"{cid}.assets_line", abs(line["amount_mad"]) if line else -1, exp["assets_line_mad"])
    if "siem_charge_mad" in exp:
        line = next((l for l in r["lines"] if l["key"] == "siem"), None)
        check(f"{cid}.siem_charge", line["amount_mad"] if line else 0.0, exp["siem_charge_mad"])
    if "backup_overage_mad" in exp:
        line = next((l for l in r["lines"] if l["key"] in ("backup_over", "backup_overage")), None)
        check(f"{cid}.backup_overage", line["amount_mad"] if line else 0.0, exp["backup_overage_mad"])
    if "retention_uplift_mad" in exp:
        line = next((l for l in r["lines"] if l["key"] == "retention"), None)
        check(f"{cid}.retention_uplift", line["amount_mad"] if line else 0.0, exp["retention_uplift_mad"])
    if "contract_discount_mad" in exp:
        check(f"{cid}.contract_discount", t["contract_discount_mad"], exp.get("contract_discount_mad", t["contract_discount_mad"]))
    if "partner_discount_mad" in exp:
        check(f"{cid}.partner_discount", t["partner_discount_mad"], exp.get("partner_discount_mad", t["partner_discount_mad"]))
    if exp.get("cap_applied") is not None:
        if bool(t.get("cap_applied")) != exp["cap_applied"]:
            failures.append(f"{cid}.cap_applied: {t.get('cap_applied')} want {exp['cap_applied']}")

print(f"\n{'FAIL' if failures else 'PASS'}: {len(FIXTURES['cases'])} golden cases, {len(failures)} failure(s)")
for f in failures:
    print("  ✗", f)

# --------------------------------------------------------------------------- #
# Embedded fallback config must be byte-for-byte equivalent to the canonical
# JSON (app/core/pricing_config.json). Guards the load_config() robustness path.
# --------------------------------------------------------------------------- #
from app.services.pricing_engine import _EMBEDDED_CONFIG_JSON, load_config  # noqa: E402

_json_path = os.path.join(ROOT, "backend", "app", "core", "pricing_config.json")
canonical = json.load(open(_json_path, encoding="utf-8"))
embedded = json.loads(_EMBEDDED_CONFIG_JSON)
if canonical != embedded:
    failures.append("embedded fallback config != backend/app/core/pricing_config.json")
if load_config("/nonexistent/pricing_config.json") != canonical:
    failures.append("load_config() fallback did not return the canonical config")

sys.exit(1 if failures else 0)
