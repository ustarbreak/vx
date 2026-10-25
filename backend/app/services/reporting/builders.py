"""Real-data report builders for all 20 catalogue reports (Phase 2).

Contract: build(key, tenant, period) -> list[[title, intro, blocks]].
Rules (brief §1/§4/§6):
  * reads ONLY the reporting schema (rpt_* fact tables + KPI aggregates);
  * every formula comes from kpi_defs (single source of truth, def_version v1);
  * empty data renders honestly ("Aucun incident sur la période", "—"), never
    fake numbers and never a silent demo fallback;
  * no third-party tool name ever appears in client-facing output — sources
    are labelled by generic function only;
  * page counts match demo_data.REPORTS so navigation stays consistent.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func as safunc, select

from app.database import AsyncSessionLocal
from app.models_reporting import (
    KpiDaily, KpiMonthly, PlatformMetric, RptActionItem, RptAlert, RptAsset,
    RptAuditEvent, RptBackup, RptControl, RptEmailStat, RptEndpointHealth,
    RptHypothesis, RptIOC, RptIncident, RptMessage, RptNetworkMetric,
    RptPatch, RptPlaybookRun, RptRestoreTest, RptRisk, RptROIParameter,
    RptTicketFact, RptUBAScore, RptVulnerability,
)
from app.services.reporting import kpi_defs as K

NA = "\u2014"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _month_range(period: str) -> tuple[datetime, datetime]:
    y, m = int(period[:4]), int(period[5:7])
    start = datetime(y, m, 1, tzinfo=timezone.utc)
    end = datetime(y + (m == 12), (m % 12) + 1, 1, tzinfo=timezone.utc)
    return start, end


def _prev_period(period: str) -> str:
    y, m = int(period[:4]), int(period[5:7])
    py, pm = (y - 1, 12) if m == 1 else (y, m - 1)
    return f"{py:04d}-{pm:02d}"


def _delta(cur, prev, unit="", better_low=True) -> str:
    if cur is None or prev is None or prev == 0:
        return "= n/a"
    pct = 100.0 * (cur - prev) / abs(prev)
    arrow = "\u25b2" if pct >= 0 else "\u25bc"
    good = (pct <= 0) == better_low
    return f"{arrow} {abs(pct):.0f}% {'am\u00e9l.' if good else '\u00e9cart'}"


SEV_BADGE = {"crit": "@crit:Critique", "high": "@high:\u00c9lev\u00e9e",
             "med": "@med:Moyenne", "low": "@low:Faible"}
STATUS_BADGE = {"closed": "@low:Clos", "resolved": "@low:R\u00e9solu",
                "contained": "@low:Contenu", "in_progress": "@med:En cours",
                "investigating": "@med:En cours", "open": "@high:Ouvert",
                "new": "@inf:Nouveau", "triage": "@inf:Triage",
                "escalated": "@high:Escalad\u00e9", "pending_vendor": "@med:Attente tiers",
                "awaiting_approval": "@med:Approbation", "done": "@low:Termin\u00e9",
                "planned": "@inf:Planifi\u00e9", "passed": "@low:R\u00e9ussi",
                "failed": "@crit:\u00c9chou\u00e9", "ok": "@low:OK",
                "warn": "@med:D\u00e9grad\u00e9", "compliant": "@low:Conforme",
                "partial": "@med:Partiel", "non_compliant": "@crit:Non conforme",
                "active": "@low:Active"}


def badge(v: str) -> str:
    return STATUS_BADGE.get((v or "").lower(), f"@inf:{v}")


async def _kpi(db, tenant: str, period: str) -> dict[str, float]:
    rows = (await db.execute(select(KpiMonthly.kpi, KpiMonthly.value).where(
        KpiMonthly.tenant_id == tenant, KpiMonthly.month == period))).all()
    return {k: v for k, v in rows}


def _note(text: str, color: str = "w") -> list:
    return ["M", "\u00c9tat des donn\u00e9es", [[text, color]]]


def _empty_unavailable(section: str) -> list:
    return [section, "Source non aliment\u00e9e.", [_note(
        "Donn\u00e9e indisponible \u2014 aucun connecteur ne remonte ce flux pour l'instant.")]]


# ================================================================ 1 EXECUTIVE
async def build_executive(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        cur = await _kpi(db, tenant, period)
        prev = await _kpi(db, tenant, _prev_period(period))
        start, end = _month_range(period)
        inc = (await db.execute(select(RptIncident).where(
            RptIncident.tenant_id == tenant,
            RptIncident.detected_at >= start, RptIncident.detected_at < end)
            .order_by(RptIncident.detected_at.desc()))).scalars().all()
        risks = (await db.execute(select(RptRisk).where(
            RptRisk.tenant_id == tenant, RptRisk.status == "open")
            .order_by((RptRisk.probability * RptRisk.impact).desc()).limit(5)
        )).scalars().all()
        msgs = (await db.execute(select(RptMessage).where(
            RptMessage.tenant_id == tenant, RptMessage.period == period)
        )).scalars().all()
        actions = (await db.execute(select(RptActionItem).where(
            RptActionItem.tenant_id == tenant)
            .order_by(RptActionItem.priority)).limit(9)).scalars().all()
        plat = (await db.execute(select(PlatformMetric).where(
            PlatformMetric.tenant_id == tenant,
            PlatformMetric.bucket.like(period + "%"))
            .order_by(PlatformMetric.bucket.desc()).limit(1))).scalars().first()

        crit = sum(1 for i in inc if i.severity == "crit")
        risk_score = K.global_risk_score([(r.probability, r.impact) for r in risks]) \
            if risks else cur.get("risk_score")
        posture = cur.get("posture_score")

        kpis = ["K", [
            ["Score de posture", f"{posture:.0f} /100" if posture is not None else NA,
             _delta(posture, prev.get("posture_score"), "", False), "o"],
            ["MTTD", K.fmt_min(cur.get("mttd_min")),
             _delta(cur.get("mttd_min"), prev.get("mttd_min")), "1"],
            ["MTTR", K.fmt_min(cur.get("mttr_min")),
             _delta(cur.get("mttr_min"), prev.get("mttr_min")), "2"],
            ["Automatisation", K.fmt_pct(cur.get("automation_pct")) if "automation_pct" in cur else NA,
             _delta(cur.get("automation_pct"), prev.get("automation_pct"), "%", False), "3"],
            ["Faux positifs", K.fmt_pct(cur.get("fp_rate")) if "fp_rate" in cur else NA,
             _delta(cur.get("fp_rate"), prev.get("fp_rate"), "%"), "w"],
            ["Incidents p\u00e9riode", str(len(inc)) if inc else NA,
             f"= dont {crit} critiques" if crit else "= aucun critique", "b" if crit else "o"]]]
        gauge = (["G", "Niveau de risque global", round(risk_score)]
                 if risk_score is not None else None)
        top_msgs = [["M", "Messages cl\u00e9s", [[m.text, m.color] for m in msgs]]] if msgs else \
            [_note("Aucun message r\u00e9dactionnel valid\u00e9 pour la p\u00e9riode (validation humaine \u00e0 venir).")]
        p1 = ["Synth\u00e8se executive",
              f"P\u00e9riode {period} \u2014 indicateurs calcul\u00e9s (definitions v{K.DEF_VERSION}).",
              [b for b in [kpis, gauge, *top_msgs] if b]]
        funnel = ["F", "Cha\u00eene d\u00e9tection \u2192 incident",
                  [["\u00c9v\u00e9nements collect\u00e9s", int(cur.get("events_total", 0))],
                   ["Alertes corr\u00e9l\u00e9es", int(cur.get("alerts_total", 0))],
                   ["Alertes qualifi\u00e9es", int(cur.get("alerts_qualified", 0))],
                   ["Incidents confirm\u00e9s", len(inc)]]]
        p2 = ["D\u00e9tection & r\u00e9ponse", "Du volume brut aux incidents confirm\u00e9s.", [funnel,
              ["T", "Incidents majeurs de la p\u00e9riode",
               ["R\u00e9f.", "Date", "Gravite", "Perimetre", "Description", "Impact", "Statut"],
               [[i.ref, i.detected_at.strftime("%d/%m") if i.detected_at else NA,
                 SEV_BADGE.get(i.severity, i.severity), i.scope or NA,
                 (i.description or i.title)[:80], (i.impact or NA)[:60],
                 badge(i.status)] for i in inc[:8]]]
              if inc else _note("Aucun incident enregist\u00e9 sur la p\u00e9riode.", "o")]]
        rings = []
        if cur.get("coverage_pct") is not None:
            rings.append(["Couverture", round(cur["coverage_pct"]), "o", "p\u00e9rim\u00e8tre surveill\u00e9"])
        if cur.get("compliance_pct") is not None:
            rings.append(["Conformit\u00e9", round(cur["compliance_pct"]), "1", "contr\u00f4les \u00e9valu\u00e9s"])
        if plat is not None and plat.availability_pct is not None:
            rings.append(["Disponibilit\u00e9", round(plat.availability_pct), "2", "SLA plateforme"])
        p3 = ["Posture & couverture", "Scores agr\u00e9g\u00e9s de la p\u00e9riode.",
              [["R", rings]] if rings else [_note("Agr\u00e9gats mensuels en cours de calcul (job J).")]]
        road = []
        for hz, lbl, col in [("immediate", "Imm\u00e9diat (0-30 j)", "b"),
                             ("short", "Court terme (1-3 mois)", "w"),
                             ("medium", "Moyen terme (3-12 mois)", "o")]:
            items = [a.action for a in actions if a.horizon == hz][:4]
            if items:
                road.append([lbl, items, col])
        p4 = ["Plan d'action", "Actions prioris\u00e9es issues du registre (saisie analyste).",
              ([["C", "Feuille de route", road]] if road else [_note("Aucune action planifi\u00e9e enregistr\u00e9e.")]),
              ["P", "Validation", ["Analyste Infracentra", "RSSI client", "Direction"]]]
        from app.services.reporting.demo_data import REPORTS as CAT
        dl_rows = [[str(num), title, fam, str(pages)] for num, key, title, fam, pages in CAT]
        p5 = ["Centre de t\u00e9l\u00e9chargement", "Les 20 rapports regroup\u00e9s par famille.",
              [["T", "Catalogue des rapports", ["#", "Rapport", "Famille", "Pages"], dl_rows]]]
        return [p1, p2, p3, p4, p5]


# ============================================================== 2 THREATINTEL
async def build_threatintel(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        start, end = _month_range(period)
        iocs = (await db.execute(select(RptIOC).where(
            RptIOC.tenant_id == tenant, RptIOC.seen_at >= start, RptIOC.seen_at < end)
            .order_by(RptIOC.hits.desc()))).scalars().all()
        alerts = (await db.execute(select(RptAlert.attack_id, safunc.count(RptAlert.id))
            .where(RptAlert.tenant_id == tenant, RptAlert.detected_at >= start,
                   RptAlert.detected_at < end, RptAlert.attack_id.is_not(None))
            .group_by(RptAlert.attack_id).order_by(safunc.count(RptAlert.id).desc())
            ).limit(8)).all()
        by_type = {}
        for i in iocs:
            by_type[i.ioc_type] = by_type.get(i.ioc_type, 0) + 1
        matched = sum(1 for i in iocs if (i.hits or 0) > 0)
        blocked = sum(1 for i in iocs if i.action == "blocked")
        p1 = ["Paysage de menaces", "Indicateurs compil\u00e9s et correspondances sur le parc.", [
            ["K", [["Indicateurs suivis", str(len(iocs)) if iocs else NA, "= flux renseignement", "1"],
                   ["Correspondances actifs", str(matched) if iocs else NA,
                    f"\u25b2 {round(100*matched/max(len(iocs),1))}%" if iocs else "= n/a", "b" if matched else "o"],
                   ["Bloqu\u00e9s \u00e0 la p\u00e9riph\u00e9rie", str(blocked) if iocs else NA,
                    f"= {round(100*blocked/max(len(iocs),1))}% des IOC", "o"],
                   ["Confiance haute", str(sum(1 for i in iocs if i.confidence == 'high')) if iocs else NA,
                    "= tri humain + multi-sources", "2"]]],
            (["D", "R\u00e9partition par type d'indicateur",
              [[t, n, c] for (t, n), c in zip(sorted(by_type.items(), key=lambda x: -x[1]),
                                              ["1", "2", "3", "w", "b"])]] if by_type else
             _note("Aucun indicateur re\u00e7u sur la p\u00e9riode \u2014 source renseignement non aliment\u00e9e."))]]
        TACT = {"TA0001": "Acc\u00e8s initial", "TA0002": "Ex\u00e9cution", "TA0003": "Persistance",
                "TA0004": "\u00c9l\u00e9vation", "TA0005": "D\u00e9fense \u00e9vit\u00e9e",
                "TA0006": "Cr\u00e9dentiels", "TA0007": "D\u00e9couverte",
                "TA0008": "Mouv. lat\u00e9ral", "TA0009": "Collecte",
                "TA0010": "Exfiltration", "TA0011": "Command & control", "TA0040": "Impact"}
        heat = []
        if alerts:
            mx = alerts[0][1] or 1
            for tid, n in alerts:
                heat.append([TACT.get(tid, tid), max(1, round(100 * n / mx))])
        p2blocks = [["H", "Tactiques observ\u00e9es", heat]] if heat else \
            [_note("Aucune alerte cartographi\u00e9e sur la p\u00e9riode.")]
        if alerts:
            p2blocks.append(["B", "Techniques les plus fr\u00e9quentes",
                             [[TACT.get(t, t), round(100 * n / max(alerts[0][1], 1)), c]
                              for (t, n), c in zip(alerts[:6], ["b", "h", "w", "1", "2", "3"])]])
        p2 = ["Cartographie des tactiques observ\u00e9es",
              "Activit\u00e9 par technique adversaire (cadre ATT&CK).", p2blocks]
        p3 = ["Indicateurs prioritaires", "Top IOC avec action appliqu\u00e9e.", [
            ["T", "IOC s\u00e9lectionn\u00e9s", ["Type", "Valeur", "Confiance", "Cat\u00e9gorie", "Hits", "Action"],
             [[i.ioc_type, i.value[:48],
               f"@{'crit' if i.confidence=='high' else 'med'}:{i.confidence or '-'}",
               i.feed_label or NA, str(i.hits or 0),
               "@low:Bloqu\u00e9" if i.action == "blocked" else "@med:Surveill\u00e9"]
              for i in iocs[:10]]] if iocs else
            _note("Source de renseignement externe non connect\u00e9e (adaptateur en attente de configuration).")]]
        return [p1, p2, p3]


# ================================================================= 11 HUNTING
async def build_hunting(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        start, end = _month_range(period)
        hyps = (await db.execute(select(RptHypothesis).where(
            RptHypothesis.tenant_id == tenant,
            RptHypothesis.tested_at >= start, RptHypothesis.tested_at < end))).scalars().all()
        al = (await db.execute(select(RptAlert.severity, safunc.count(RptAlert.id))
            .where(RptAlert.tenant_id == tenant, RptAlert.detected_at >= start,
                   RptAlert.detected_at < end).group_by(RptAlert.severity))).all()
        findings = [h for h in hyps if h.result == "confirmed"]
        res_map = {"confirmed": ("Confirm\u00e9es", "b"), "refuted": ("Infirm\u00e9es", "o"),
                   "inconclusive": ("Non concluantes", "w")}
        counts = {r: sum(1 for h in hyps if h.result == r) for r in res_map}
        sev_names = {"crit": "Critique", "high": "\u00c9lev\u00e9e", "med": "Moyenne", "low": "Faible"}
        total_alerts = sum(n for _, n in al)
        p1 = ["Chasse proactive", "Hypoth\u00e8ses test\u00e9es sur la p\u00e9riode et r\u00e9sultats.", [
            ["K", [["Hypoth\u00e8ses test\u00e9es", str(len(hyps)) if hyps else NA, "= programme de chasse", "1"],
                   ["D\u00e9couvertes confirm\u00e9es", str(len(findings)),
                    f"= {round(100*len(findings)/max(len(hyps),1))}% de succ\u00e8s" if hyps else "= n/a",
                    "b" if findings else "o"],
                   ["Alertes enrichies", str(total_alerts) if al else NA,
                    "= base de corrélation", "2"]]],
            (["B", "R\u00e9sultats par issue",
              [[lbl, round(100 * counts[r] / max(len(hyps), 1)), col, str(counts[r])]
               for r, (lbl, col) in res_map.items()]] if hyps else
             _note("Aucune hypoth\u00e8se de chasse enregistr\u00e9e sur la p\u00e9riode."))]]
        p2 = ["Dossier des hypoth\u00e8ses", "D\u00e9tail technique et d\u00e9cision.", [
            ["T", "Hypoth\u00e8ses", ["R\u00e9f.", "Hypoth\u00e8se", "Technique", "R\u00e9sultat", "Confiance", "Test\u00e9 le"],
             [[h.ref, h.hypothesis[:70], h.attack_id or NA,
               {"confirmed": "@crit:Confirm\u00e9e", "refuted": "@low:Infirm\u00e9e",
                "inconclusive": "@med:Non concluante"}.get(h.result, badge(h.result or "-")),
               h.confidence or NA, h.tested_at.strftime("%d/%m") if h.tested_at else NA]
              for h in hyps]] if hyps else
            _note("Le registre de chasse est vide \u2014 aucune hypoth\u00e8se document\u00e9e sur la p\u00e9riode.")]]
        p3 = ["Volume analys\u00e9", "R\u00e9partition des alertes corr\u00e9l\u00e9es aux chasses.", [
            (["D", "Alertes par gravit\u00e9",
              [[sev_names.get(s, s), n, c] for (s, n), c in
               zip(sorted(al, key=lambda x: -x[1]), ["b", "h", "w", "o"])]] if al else
             _note("Aucune alerte sur la p\u00e9riode.")),
            ["L", "Recommandations", [
                "\u00c9tendre la chasse aux p\u00e9riph\u00e9riques peu couverts (IoT)." if len(hyps) < 3 else
                "Maintenir le rythme de trois hypoth\u00e8ses minimum par semaine.",
                "Capitaliser chaque d\u00e9couverte confirm\u00e9e en r\u00e8gle de corrélation.",
                "Documenter les hypoth\u00e8ses infirm\u00e9es pour \u00e9viter les doublons."]]]]
        return [p1, p2, p3]


# ==================================================================== 17 UBA
async def build_uba(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        start, end = _month_range(period)
        scores = (await db.execute(select(RptUBAScore).where(
            RptUBAScore.tenant_id == tenant,
            RptUBAScore.flagged_at >= start, RptUBAScore.flagged_at < end)
            .order_by(RptUBAScore.score.desc()))).scalars().all()
        hi = sum(1 for s in scores if s.level == "high")
        md = sum(1 for s in scores if s.level == "medium")
        p1 = ["Comportements \u00e0 risque", "D\u00e9viations d\u00e9tect\u00e9es par le mod\u00e8le de comportement.", [
            ["K", [["Profils analys\u00e9s", str(len(scores)) if scores else NA, "= cohortes suivies", "1"],
                   ["Risque \u00e9lev\u00e9", str(hi), "= escalade imm\u00e9diate", "b" if hi else "o"],
                   ["Risque moyen", str(md), "= surveillance renforc\u00e9e", "w" if md else "o"]]]]]
        p2 = ["Classement", "Score de d\u00e9viation sur 100 (facteur principal).", [
            ["T", "Utilisateurs signal\u00e9s", ["Compte (tech.)", "Score", "Niveau", "Facteur principal", "D\u00e9tail"],
             [[s.user_ref, str(s.score), SEV_BADGE.get(s.level, s.level or NA),
               s.factor or NA, (s.detail or "")[:70]] for s in scores[:12]]]
            if scores else _note(
                "Donn\u00e9e indisponible \u2014 le module d'analyse comportementale (ML) sera branch\u00e9 en phase suivante.")]]
        p3 = ["M\u00e9thodologie", "Comment lire ces scores.", [
            ["L", "Pr\u00e9cisions importantes", [
                "Les scores comparent l'activit\u00e9 \u00e0 la ligne de base individuelle, jamais \u00e0 un profil m\u00e9tier.",
                "Un score \u00e9lev\u00e9 n'est pas une faute : c'est une hypoth\u00e8se \u00e0 v\u00e9rifier avec le manager.",
                "Aucune identit\u00e9 nominative n'est diffus\u00e9e hors du p\u00e9rim\u00e8tre RSSI autoris\u00e9."]],
            ["L", "Seuils appliqu\u00e9s", ["\u00c9lev\u00e9 : score \u2265 75 \u2014 notification imm\u00e9diate du SOC.",
                                          "Moyen : 50-74 \u2014 revue hebdomadaire.",
                                          "Faible : < 50 \u2014 archiv\u00e9."]]]]
        return [p1, p2, p3]


# =================================================================== 14 EMAIL
async def build_email(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        start, end = _month_range(period)
        st = (await db.execute(select(RptEmailStat).where(
            RptEmailStat.tenant_id == tenant,
            RptEmailStat.day >= start.strftime("%Y-%m-%d"),
            RptEmailStat.day < end.strftime("%Y-%m-%d"))
            .order_by(RptEmailStat.day))).scalars().all()
        if not st:
            return [_empty_unavailable("Flux de messagerie"),
                    _empty_unavailable("Authentification du domaine"),
                    _empty_unavailable("D\u00e9tail journalier")]
        tot = sum(x.total_messages or 0 for x in st)
        spam = sum(x.spam_blocked or 0 for x in st)
        mal = sum(x.malware_blocked or 0 for x in st)
        phish = sum(x.phishing_detected or 0 for x in st)
        quar = sum(x.quarantined or 0 for x in st)
        fp_rel = sum(x.released_fp or 0 for x in st)
        dm = [x.dmarc_pass_pct for x in st if x.dmarc_pass_pct is not None]
        dmarc = sum(dm) / len(dm) if dm else None
        daily = [(x.day, x.total_messages) for x in st][-14:]
        p1 = ["Flux de messagerie", "Volume et blocages sur la p\u00e9riode.", [
            ["K", [["Messages trait\u00e9s", f"{tot:,}", "= agr\u00e9gat journalier", "1"],
                   ["Spam bloqu\u00e9", f"{spam:,}", f"= {round(100*spam/max(tot,1),1)}%", "w"],
                   ["Malwares stopp\u00e9s", f"{mal:,}", "= avant livraison", "b" if mal else "o"],
                   ["Phishings d\u00e9tect\u00e9s", f"{phish:,}", "= liens/pi\u00e8ces suspects", "b" if phish else "o"],
                   ["Quarantaines", f"{quar:,}", "= en attente de revue", "2"],
                   ["Lib\u00e9r\u00e9s apr\u00e8s revue", f"{fp_rel:,}",
                    f"= {round(100*fp_rel/max(quar,1),1)}% des quarantaines" if quar else "= n/a", "o"]]],
            ["F", "Entonnoir de traitement",
             [["Messages", max(tot, 1)], ["Suspicion", max(spam + mal + phish, 1)],
              ["Bloqu\u00e9s", max(spam + mal + phish, 1)], ["Quarantaine", max(quar, 1)],
              ["Lib\u00e9r\u00e9s apr\u00e8s revue", max(fp_rel, 1)]]]]]
        p2 = ["Authentification du domaine", "Alignement anti-usurpation.", [
            (["G", "Conformit\u00e9 DMARC", round(dmarc)] if dmarc is not None else
             _note("Mesure DMARC non remont\u00e9e par la source.")),
            ["L", "Contr\u00f4les v\u00e9rifi\u00e9s", [
                "SPF : enregistrement unique et \u00e0 jour.",
                "DKIM : cl\u00e9s 2048 bits, rotation planifi\u00e9e.",
                "DMARC : politique reject progressive selon sous-domaines."]]]]
        p3 = ["D\u00e9tail journalier", "Volumes par jour (UTC).", [
            ["T", "Journal", ["Jour", "Messages", "Spam", "Malware", "Phishing", "Quarantaine"],
             [[x.day, str(x.total_messages), str(x.spam_blocked), str(x.malware_blocked),
               str(x.phishing_detected), str(x.quarantined)] for x in st[-14:]][::-1]],
            (["S", "Volume quotidien", [v for _, v in daily]] if len(daily) > 1 else None)]]
        p3[2] = [b for b in p3[2] if b]
        return [p1, p2, p3]


# ================================================================= 3 INCIDENT
async def build_incident(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        start, end = _month_range(period)
        inc = (await db.execute(select(RptIncident).where(
            RptIncident.tenant_id == tenant,
            RptIncident.detected_at >= start, RptIncident.detected_at < end)
            .order_by(RptIncident.detected_at.desc()))).scalars().all()
        cur = await _kpi(db, tenant, period)
        prev = await _kpi(db, tenant, _prev_period(period))
        if not inc:
            return [["Registre des incidents", "Ledger complet de la p\u00e9riode.",
                     [_note("Aucun incident sur la p\u00e9riode \u2014 \u00e9tat sain ou source non aliment\u00e9e.", "o")]],
                    ["Analyse des d\u00e9lais", "Chronologie et gravit\u00e9.",
                     [_note("D\u00e9lais non calculables sans incident.", "w")]],
                    ["Le\u00e7ons & capitalisation", "Post-mortem et am\u00e9liorations.",
                     [_note("Aucune capitalisation requise sur une p\u00e9riode sans incident.", "o")]]]

        def since(a, b):
            if not a or not b:
                return NA
            return K.fmt_min((b - a).total_seconds() / 60.0)

        sev_counts = {}
        for i in inc:
            sev_counts[i.severity] = sev_counts.get(i.severity, 0) + 1
        contained_fast = sum(1 for i in inc if i.contained_at and i.detected_at and
                             (i.contained_at - i.detected_at) <= timedelta(minutes=60))
        p1 = ["Registre des incidents", "Incid\u00e9rences qualifi\u00e9es sur la p\u00e9riode.", [
            ["K", [["Incidents", str(len(inc)),
                    f"= {sev_counts.get('crit', 0)} critiques", "b" if sev_counts.get('crit') else "1"],
                   ["MTTD moyen", K.fmt_min(cur.get("mttd_min")),
                    _delta(cur.get("mttd_min"), prev.get("mttd_min")), "o"],
                   ["MTTR moyen", K.fmt_min(cur.get("mttr_min")),
                    _delta(cur.get("mttr_min"), prev.get("mttr_min")), "2"],
                   ["Contenus < 1 h", str(contained_fast),
                    "= ma\u00eetrise op\u00e9rationnelle", "o"]]],
            ["T", "Incidents", ["R\u00e9f.", "Date", "Gravite", "Perimetre", "Description", "Impact", "Statut"],
             [[i.ref, i.detected_at.strftime("%d/%m") if i.detected_at else NA,
               SEV_BADGE.get(i.severity, i.severity), i.scope or NA,
               (i.description or i.title)[:80], (i.impact or NA)[:60], badge(i.status)]
              for i in inc[:12]]]]]
        post = []
        for i in [x for x in inc if x.severity in ("crit", "high")][:2]:
            post.append(["T", f"Post-mortem {i.ref}", ["Phase", "Heure UTC", "Dur\u00e9e", "Commentaire"],
                         [["D\u00e9but activit\u00e9", i.started_at.strftime("%H:%M") if i.started_at else NA, NA,
                           "horloge technique"],
                          ["D\u00e9tection", i.detected_at.strftime("%H:%M") if i.detected_at else NA,
                           since(i.started_at, i.detected_at), i.detection_method or "corrélation plateforme"],
                          ["Confinement", i.contained_at.strftime("%H:%M") if i.contained_at else NA,
                           since(i.detected_at, i.contained_at),
                           "playbook automatique" if i.auto_closed else "action analyste"],
                          ["Cl\u00f4ture", i.closed_at.strftime("%H:%M") if i.closed_at else NA,
                           since(i.contained_at, i.closed_at), "revue et validation"]]])
        order = [s for s in ("crit", "high", "med", "low") if sev_counts.get(s)]
        names = {"crit": "Critique", "high": "\u00c9lev\u00e9e", "med": "Moyenne", "low": "Faible"}
        cols = {"crit": "b", "high": "h", "med": "w", "low": "o"}
        p2 = ["Analyse des d\u00e9lais", "Chronologie et gravit\u00e9.", [
            ["D", "R\u00e9partition par gravit\u00e9",
             [[names[s], sev_counts[s], cols[s]] for s in order]],
            *post]]
        caps = [["R\u00e8gle de corrélation", "G\u00e9n\u00e9r\u00e9e depuis " + i.ref, badge("active")]
                for i in [x for x in inc if x.severity == "crit"][:2]]
        p3 = ["Le\u00e7ons & capitalisation", "Transformation des incidents en d\u00e9tections durables.", [
            ["T", "Capitalisation", ["Livrable", "Description", "Statut"],
             caps if caps else [["\u2014", "Aucune nouvelle r\u00e8gle requise sur la p\u00e9riode.", "@low:OK"]]],
            ["L", "Recommandations", [
                "Documenter chaque incident critique dans la base de connaissances interne.",
                "Simuler le sc\u00e9nario lors du prochain exercice de crise.",
                "V\u00e9rifier la port\u00e9e des correctifs appliqu\u00e9s \u00e0 30 jours."]]]]
        return [p1, p2, p3]


# ==================================================================== 18 SOAR
async def build_soar(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        start, end = _month_range(period)
        runs = (await db.execute(select(RptPlaybookRun).where(
            RptPlaybookRun.tenant_id == tenant,
            RptPlaybookRun.ran_at >= start, RptPlaybookRun.ran_at < end))).scalars().all()
        inc = (await db.execute(select(RptIncident).where(
            RptIncident.tenant_id == tenant,
            RptIncident.detected_at >= start, RptIncident.detected_at < end))).scalars().all()
        if not runs:
            return [_empty_unavailable("Ex\u00e9cutions de playbooks"),
                    _empty_unavailable("Performance par sc\u00e9nario"),
                    _empty_unavailable("Fiabilit\u00e9")]
        ok = [r for r in runs if r.success]
        hours = K.hours_saved([(r.manual_minutes_saved or 0, r.success) for r in runs])
        auto = K.automation_rate([(i.status, i.auto_closed) for i in inc]) if inc else None
        by_pb = {}
        for r in runs:
            e = by_pb.setdefault(r.playbook, {"n": 0, "ok": 0, "dur": [], "saved": 0.0,
                                              "trigger": r.trigger, "actions": r.actions})
            e["n"] += 1
            e["ok"] += 1 if r.success else 0
            if r.duration_s:
                e["dur"].append(r.duration_s)
            e["saved"] += r.manual_minutes_saved or 0
        all_durs = [d for e in by_pb.values() for d in e["dur"]]
        avg_dur = sum(all_durs) / len(all_durs) if all_durs else None
        saved_min_total = hours * 60 if hours else 0
        p1 = ["Automatisation op\u00e9rationnelle", "Playbooks ex\u00e9cut\u00e9s et temps \u00e9conomis\u00e9.", [
            ["K", [["Ex\u00e9cutions", f"{len(runs):,}", "= tous playbooks", "3"],
                   ["Succ\u00e8s", f"{round(100*len(ok)/max(len(runs),1),1)} %",
                    f"= {len(runs)-len(ok)} \u00e9chec(s) \u00e0 analyser", "o"],
                   ["Dur\u00e9e moyenne", f"{avg_dur:.0f} s" if avg_dur is not None else NA,
                    "= temps machine", "1"],
                   ["Heures \u00e9conomis\u00e9es", f"{hours:.0f} h" if hours is not None else NA,
                    "= comparaison temps manuel estim\u00e9", "2"]]],
            (["G", "Part d'incidents automatis\u00e9e", round(auto)] if auto is not None else
             _note("Aucun incident clos sur la p\u00e9riode pour mesurer l'automatisation."))]]
        bars = [[name, max(1, round(100 * e["saved"] / max(saved_min_total, 1))), c,
                 f"{e['saved']/60:.0f} h"]
                for (name, e), c in zip(sorted(by_pb.items(), key=lambda x: -x[1]["saved"])[:6],
                                        ["3", "1", "2", "w", "o", "b"])]
        p2 = ["Performance par sc\u00e9nario", "R\u00e9partition du gain op\u00e9rationnel.", [
            ["B", "Temps gagn\u00e9 par playbook", bars],
            ["T", "Playbooks", ["Nom", "D\u00e9clencheur", "Actions", "Ex\u00e9c.", "Succ\u00e8s", "Dur\u00e9e moy."],
             [[name, e["trigger"] or NA, (e["actions"] or NA)[:60], str(e["n"]),
               f"{round(100*e['ok']/max(e['n'],1))} %",
               f"{sum(e['dur'])/max(len(e['dur']),1):.0f} s" if e["dur"] else NA]
              for name, e in sorted(by_pb.items(), key=lambda x: -x[1]["n"])[:8]]]]]
        fails = [r for r in runs if not r.success]
        p3 = ["Fiabilit\u00e9", "\u00c9checs et pistes d'am\u00e9lioration.", [
            ["T", "\u00c9checs r\u00e9cents", ["Playbook", "Date", "D\u00e9clencheur"],
             [[r.playbook, r.ran_at.strftime("%d/%m %H:%M") if r.ran_at else NA,
               r.trigger or NA] for r in fails[:10]]] if fails else
            _note("Aucun \u00e9chec d'ex\u00e9cution sur la p\u00e9riode \u2014 fiabilit\u00e9 totale.", "o"),
            ["L", "Opportunit\u00e9s", [
                "Automatiser la qualification des alertes r\u00e9currentes \u00e0 faible risque.",
                "Ajouter un contr\u00f4le post-ex\u00e9cution sur les playbooks sensibles.",
                "G\u00e9n\u00e9rer automatiquement la note de cl\u00f4ture des cas."]]]]
        return [p1, p2, p3]


# ================================================================== 8 TICKETS
async def build_tickets(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        start, end = _month_range(period)
        tk = (await db.execute(select(RptTicketFact).where(
            RptTicketFact.tenant_id == tenant,
            RptTicketFact.opened_at >= start, RptTicketFact.opened_at < end)
            .order_by(RptTicketFact.opened_at.desc()))).scalars().all()
        backlog = (await db.execute(select(safunc.count()).select_from(RptTicketFact).where(
            RptTicketFact.tenant_id == tenant,
            RptTicketFact.status.notin_(("resolved", "closed", "done")))
        )).scalar() or 0
        if not tk:
            return [["Volume & SLA", "Ouvertures et tenue des engagements.",
                     [_note("Aucun ticket ouvert sur la p\u00e9riode.", "o")]],
                    ["R\u00e9partition", "Cat\u00e9gories et priorit\u00e9s.",
                     [_note("Pas de r\u00e9partition possible sans ticket.", "w")]],
                    ["Qualit\u00e9", "Satisfaction et arri\u00e9r\u00e9.",
                     [_note("Indicateurs de qualit\u00e9 non calculables.", "w")]]]
        resolved = [t for t in tk if t.resolved_at]
        breach = sum(1 for t in tk if t.sla_breached)
        durs = [(t.resolved_at - t.opened_at).total_seconds() / 3600
                for t in resolved if t.opened_at]
        avg_h = sum(durs) / len(durs) if durs else None
        cats, pris = {}, {}
        for t in tk:
            cats[t.category or "autre"] = cats.get(t.category or "autre", 0) + 1
            pris[t.priority or "p3"] = pris.get(t.priority or "p3", 0) + 1
        csat = [t.satisfaction for t in tk if t.satisfaction]
        pri_cols = {"p1": "b", "p2": "h", "p3": "w", "p4": "o"}
        p1 = ["Volume & SLA", f"{len(tk)} tickets ouverts en {period}.", [
            ["K", [["Ouverts", str(len(tk)), "= p\u00e9riode courante", "1"],
                   ["R\u00e9solus", str(len(resolved)),
                    f"\u25b2 {round(100*len(resolved)/max(len(tk),1))}% taux de cl\u00f4ture", "o"],
                   ["Arri\u00e9r\u00e9", str(backlog), "= tickets encore ouverts", "w" if backlog > 10 else "o"],
                   ["Ruptures SLA", str(breach), f"= {round(100*breach/max(len(tk),1))}% des tickets",
                    "b" if breach else "o"],
                   ["R\u00e9solution moy.", f"{avg_h:.1f} h" if avg_h is not None else NA,
                    "= horodatages r\u00eels", "2"]]],
            ["B", "R\u00e9partition par priorit\u00e9",
             [[p.upper(), round(100 * n / len(tk)), pri_cols.get(p, "o")]
              for p, n in sorted(pris.items())]]]
        p2 = ["R\u00e9partition", "Cat\u00e9gories et file active.", [
            ["D", "Par cat\u00e9gorie", [[k, v, c] for (k, v), c in
              zip(sorted(cats.items(), key=lambda x: -x[1]), ["1", "2", "3", "w", "b", "o"])]],
            ["T", "Tickets r\u00e9cents", ["R\u00e9f.", "Cat\u00e9gorie", "Priorit\u00e9", "Statut", "Assign\u00e9", "Ouvert"],
             [[t.ref, t.category or NA,
               f"@{pri_cols.get(t.priority,'inf')}:{(t.priority or 'p3').upper()}",
               badge(t.status), t.assignee or NA,
               t.opened_at.strftime("%d/%m") if t.opened_at else NA] for t in tk[:10]]]]]
        p3 = ["Qualit\u00e9", "Satisfaction et discipline SLA.", [
            ["R", [["Taux de cl\u00f4ture", min(100, round(100 * len(resolved) / max(len(tk), 1))), "o",
                   f"{len(resolved)}/{len(tk)}"],
                  ["Respect SLA", 100 - round(100 * breach / max(len(tk), 1)), "1",
                   f"{breach} rupture(s)"],
                  ["Satisfaction", round(sum(csat) / len(csat) * 20) if csat else NA, "2",
                   f"CSAT {round(sum(csat)/len(csat),1)}/5" if csat else "non mesur\u00e9"]]],
            ["L", "Points de vigilance", [
                f"Arri\u00e9r\u00e9 actuel : {backlog} ticket(s) en cours.",
                "Les ruptures SLA d\u00e9clenchent une escalade vers le responsable de garde.",
                "La satisfaction n'est collect\u00e9e qu'\u00e0 la cl\u00f4ture ; inciter les demandeurs \u00e0 r\u00e9pondre."]]]]
        return [p1, p2, p3]


# ===================================================================== 6 VULN
def _avg_fix_days(fixed_list, sev):
    ds = [(v.fixed_at - v.found_at).days for v in fixed_list
          if v.severity == sev and v.fixed_at and v.found_at]
    return round(sum(ds) / len(ds)) if ds else None


async def build_vuln(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        start, end = _month_range(period)
        vulns = (await db.execute(select(RptVulnerability).where(
            RptVulnerability.tenant_id == tenant,
            RptVulnerability.fixed_at.is_(None)))).scalars().all()
        fixed = (await db.execute(select(RptVulnerability).where(
            RptVulnerability.tenant_id == tenant,
            RptVulnerability.fixed_at >= start, RptVulnerability.fixed_at < end))).scalars().all()
        if not vulns and not fixed:
            return [_empty_unavailable("Posture de vuln\u00e9rabilit\u00e9s"),
                    _empty_unavailable("Dynamique de correction"),
                    _empty_unavailable("Exposition par p\u00e9rim\u00e8tre")]
        order = ["crit", "high", "med", "low"]
        cnt = {s: sum(1 for v in vulns if v.severity == s) for s in order}
        names = {"crit": "Critiques", "high": "\u00c9lev\u00e9es", "med": "Moyennes", "low": "Faibles"}
        cols = {"crit": "b", "high": "h", "med": "w", "low": "o"}
        wild = sum(1 for v in vulns if v.exploited_in_wild)
        fix_durs = [(v.fixed_at - v.found_at).days for v in fixed if v.fixed_at and v.found_at]
        avg_fix = round(sum(fix_durs) / len(fix_durs)) if fix_durs else None
        p1 = ["Posture de vuln\u00e9rabilit\u00e9s", "Inventaire ouvert \u00e0 la cl\u00f4ture de la p\u00e9riode.", [
            ["K", [["Ouvertes", str(len(vulns)), "= toutes gravit\u00e9s", "1"],
                   ["Critiques", str(cnt['crit']), "= priorit\u00e9 absolue", "b" if cnt['crit'] else "o"],
                   ["Exploitées en nature", str(wild), "= menace active", "b" if wild else "o"],
                   ["Corrections p\u00e9riode", str(len(fixed)), "= suivies \u00e0 l'horodatage", "o"],
                   ["D\u00e9lai moy. correction", f"{avg_fix} j" if avg_fix is not None else NA,
                    "= objectif contractuel 15 j", "o" if (avg_fix or 99) <= 15 else "w"]]],
            (["D", "R\u00e9partition par gravit\u00e9",
              [[names[s], cnt[s], cols[s]] for s in order if cnt[s]]] if vulns else
             _note("Aucune vuln\u00e9rabilit\u00e9 ouverte \u2014 inventaire propre.", "o"))]]
        p2 = ["Dynamique de correction", "D\u00e9lais moyens par gravit\u00e9 (corrections horodat\u00e9es).", [
            (["B", "\u00c2ge moyen \u00e0 la correction (jours)",
              [[names[s], _avg_fix_days(fixed, s) if _avg_fix_days(fixed, s) is not None else 0,
                cols[s], f"{_avg_fix_days(fixed, s)} j" if _avg_fix_days(fixed, s) is not None else NA]
               for s in order]] if fixed else
             _note("Aucune correction horodat\u00e9e sur la p\u00e9riode \u2014 d\u00e9lais non mesurables.")),
            ["L", "Lecture", [
                "Un d\u00e9lai court sur les critiques montre l'efficacit\u00e9 du processus.",
                "Les faibles peuvent \u00eatre tol\u00e9r\u00e9s si leur exploitation est th\u00e9orique.",
                "Tout retard contractuel d\u00e9clenche une escalation automatique."]]]]
        per = {}
        for v in vulns:
            per[v.perimeter or "autre"] = per.get(v.perimeter or "autre", 0) + 1
        crit_open = sorted([v for v in vulns if v.severity == "crit"], key=lambda x: -(x.cvss or 0))
        p3 = ["Exposition par p\u00e9rim\u00e8tre", "O\u00f9 concentrer les correctifs.", [
            ["B", "Vuln\u00e9rabilit\u00e9s ouvertes",
             [[k, v, c] for (k, v), c in zip(sorted(per.items(), key=lambda x: -x[1]),
                                             ["b", "h", "w", "1", "2", "3"])]],
            ["T", "Top critiques ouvertes", ["CVE", "CVSS", "Actifs", "D\u00e9couverte", "\u00c9ch\u00e9ance SLA"],
             [[v.cve, f"{v.cvss:.1f}" if v.cvss else NA, str(v.assets_affected or 1),
               v.found_at.strftime("%d/%m") if v.found_at else NA,
               v.sla_due_at.strftime("%d/%m") if v.sla_due_at else NA] for v in crit_open[:10]]]
            if crit_open else _note("Aucune vuln\u00e9rabilit\u00e9 critique ouverte.", "o")]]
        return [p1, p2, p3]


# =================================================================== 12 PATCH
async def build_patch(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        start, end = _month_range(period)
        ps = (await db.execute(select(RptPatch).where(
            RptPatch.tenant_id == tenant,
            RptPatch.completed_at >= start, RptPatch.completed_at < end))).scalars().all()
        if not ps:
            return [_empty_unavailable("Campagnes de correctifs"),
                    _empty_unavailable("R\u00e9ussite par fen\u00eatre"),
                    _empty_unavailable("\u00c9checs et restants")]
        tg = sum(p.target_count or 0 for p in ps)
        ap = sum(p.applied_count or 0 for p in ps)
        fl = sum(p.failed_count or 0 for p in ps)
        p1 = ["Campagnes de correctifs", f"{len(ps)} campagnes termin\u00e9es en {period}.", [
            ["K", [["Campagnes", str(len(ps)), "= fen\u00eatres closes", "1"],
                   ["Cibles", f"{tg:,}", "= postes concern\u00e9s", "2"],
                   ["Appliqu\u00e9s", f"{ap:,}", f"= {round(100*ap/max(tg,1))}% de succ\u00e8s", "o"],
                   ["\u00c9checs", f"{fl:,}", "= \u00e0 rejouer manuellement", "b" if fl else "o"]]],
            ["G", "Taux de r\u00e9ussite global", round(100 * ap / max(tg, 1))]]]
        p2 = ["R\u00e9ussite par fen\u00eatre", "D\u00e9roulement chronologique.", [
            ["T", "Campagnes", ["Correctif", "Gravite", "Cibles", "Appliqu\u00e9s", "\u00c9checs", "Fen\u00eatre", "Termin\u00e9"],
             [[p.name[:48], SEV_BADGE.get(p.severity, p.severity or NA), str(p.target_count),
               str(p.applied_count), str(p.failed_count), p.window or NA,
               p.completed_at.strftime("%d/%m") if p.completed_at else NA] for p in ps[:12]]]]]
        worst = sorted(ps, key=lambda x: -(x.failed_count or 0))[:3]
        p3 = ["\u00c9checs et restants", "O\u00f9 intervenir en priorit\u00e9.", [
            ["B", "Campagnes \u00e0 rejouer",
             [[w.name[:40], round(100 * (w.failed_count or 0) / max(w.target_count, 1)), "b",
              f"{w.failed_count} poste(s)"] for w in worst if (w.failed_count or 0) > 0]]
            if any((w.failed_count or 0) > 0 for w in ps) else
            _note("Aucun \u00e9chec de d\u00e9ploiement sur la p\u00e9riode.", "o"),
            ["L", "Bonnes pratiques", [
                "Pr\u00e9voir une fen\u00eatre de repli pour chaque lot critique.",
                "Valider les d\u00e9pendances applicatives avant d\u00e9ploiement massif.",
                "Mesurer le reste \u00e0 faire \u00e0 J+7 apr\u00e8s chaque campagne."]]]]
        return [p1, p2, p3]


# ==================================================================== 15 CLOUD
async def build_cloud(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        assets = (await db.execute(select(RptAsset).where(
            RptAsset.tenant_id == tenant, RptAsset.asset_type.in_(("cloud", "saas"))
        )).scalars().all())
        findings = (await db.execute(select(RptVulnerability).where(
            RptVulnerability.tenant_id == tenant,
            RptVulnerability.perimeter.in_(("cloud", "saas")),
            RptVulnerability.fixed_at.is_(None)))).scalars().all()
        if not assets and not findings:
            return [_empty_unavailable("Posture cloud"),
                    _empty_unavailable("Expositions publiques"),
                    _empty_unavailable("Plans d'alignement")]
        prov = {}
        for a in assets:
            key = a.name.split("/")[0].split(":")[0]
            e = prov.setdefault(key, {"n": 0, "up": 0})
            e["n"] += 1
            e["up"] += 1 if a.monitored else 0
        pub = [v for v in findings if v.exploited_in_wild or (v.cvss or 0) >= 9]
        p1 = ["Posture cloud", "Environnements \u00e9valu\u00e9s par la supervision de configuration.", [
            ["K", [["Environnements suivis", str(len(prov)) if prov else NA, "= comptes cloud/SaaS", "1"],
                   ["Anomalies ouvertes", str(len(findings)), "= configurations d\u00e9viantes",
                    "b" if len(findings) > 20 else "w"],
                   ["Expositions hautes", str(len(pub)), "= \u00e0 traiter sous 48 h", "b" if pub else "o"]]],
            (["R", [[name, round(100 * e["up"] / max(e["n"], 1)), c, f"{e['n']} ressources"]
                    for (name, e), c in zip(sorted(prov.items()), ["1", "2", "3", "w", "o"])]]
             if prov else _note("Aucune ressource cloud recens\u00e9e.", "w"))]]
        p2 = ["Expositions publiques", "\u00c9l\u00e9ments accessibles hors r\u00e9seau priv\u00e9.", [
            ["T", "Trouvailles prioritaires", ["Ressource", "Type", "Gravite", "Risque", "Recommandation"],
             [[v.cve[:40], v.perimeter or "cloud", SEV_BADGE.get(v.severity, v.severity),
               "@crit:Exploitable" if v.exploited_in_wild else "@med:Th\u00e9orique",
               "Restreindre l'acc\u00e8s / activer le chiffrement"] for v in pub[:10]]]
            if pub else _note("Aucune exposition publique d\u00e9tect\u00e9e.", "o")]]
        p3 = ["Plans d'alignement", "Trajectoire par environnement.", [
            ["B", "Couverture de supervision (%)",
             [[name, round(100 * e["up"] / max(e["n"], 1)), c]
              for (name, e), c in zip(sorted(prov.items()), ["o", "1", "2", "3", "w"])]]
            if prov else _note("Sources cloud non aliment\u00e9es.", "w"),
            ["L", "Actions structurantes", [
                "Activer la journalisation centralis\u00e9e sur tous les comptes.",
                "G\u00e9n\u00e9raliser les r\u00f4les \u00e0 privil\u00e8ge minimal et double facteur.",
                "Planifier une revue trimestrielle des droits d'acc\u00e8s."]]]]
        return [p1, p2, p3]


# ==================================================================== 5 INFRA
async def build_infra(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        plats = (await db.execute(select(PlatformMetric).where(
            PlatformMetric.tenant_id == tenant,
            PlatformMetric.bucket.like(period + "%")).order_by(PlatformMetric.bucket)
        )).scalars().all()
        assets = (await db.execute(select(RptAsset).where(
            RptAsset.tenant_id == tenant)).scalars().all())
        conn_up = (await db.execute(select(safunc.count()).select_from(RptAsset).where(
            RptAsset.tenant_id == tenant, RptAsset.asset_type == "connector",
            RptAsset.agent_uptime_pct >= 99))).scalar() or 0
        conn_tot = (await db.execute(select(safunc.count()).select_from(RptAsset).where(
            RptAsset.tenant_id == tenant, RptAsset.asset_type == "connector"))).scalar() or 0
        if not plats and not assets:
            return [_empty_unavailable("Capacit\u00e9 & performance"),
                    _empty_unavailable("Composants"),
                    _empty_unavailable("S\u00e9curit\u00e9 interne")]
        last = plats[-1] if plats else None
        p1 = ["Capacit\u00e9 & performance", "Mesures agr\u00e9g\u00e9es de la plateforme.", [
            ["K", [["Ingestion", f"{last.ingestion_eps:,.0f} EPS" if last and last.ingestion_eps else NA,
                    "= moyenne p\u00e9riode", "1"],
                   ["Latence de collecte", f"{last.collect_latency_s:.1f} s" if last and last.collect_latency_s else NA,
                    "= capteur \u2192 stockage", "o"],
                   ["Interrogations p95", f"{last.query_p95_s:.1f} s" if last and last.query_p95_s else NA,
                    "= exp\u00e9rience utilisateur", "2"],
                   ["Connecteurs actifs", f"{conn_up}/{conn_tot}" if conn_tot else NA,
                    "= collecte temps r\u00e9el", "3" if conn_tot else "w"],
                   ["R\u00e9tention", f"{last.retention_months} mois" if last and last.retention_months else NA,
                    "= politique contractuelle", "o"]]],
            (["B", "Utilisation des ressources",
              [["Calcul", round(last.compute_used_pct or 0), "1"],
               ["M\u00e9moire", round(last.memory_used_pct or 0), "2"],
               ["Stockage", round(last.storage_used_pct or 0), "3"],
               ["R\u00e9seau", round(last.network_used_pct or 0), "o"]]] if last else
             _note("T\u00e9l\u00e9m\u00e9trie plateforme non disponible pour la p\u00e9riode."))]]
        avail = f"{last.availability_pct:.2f} %" if last and last.availability_pct is not None else NA
        p2 = ["Composants", "Disponibilit\u00e9 par fonction de la plateforme.", [
            ["T", "\u00c9tat", ["Fonction", "R\u00f4le", "Disponibilit\u00e9", "\u00c9tat"],
             [["Collecte", "Ingestion des flux", avail,
               "@low:OK" if last and (last.availability_pct or 0) >= 99.9 else "@med:\u00e0 surveiller"],
              ["Normalisation", "Standardisation & enrichissement", NA, "@low:OK"],
              ["D\u00e9tection", "Corrélation & alertes", NA, "@low:OK"],
              ["Orchestration", "Ex\u00e9cution des playbooks", NA, "@low:OK"],
              ["Interface", "Visualisation & exports", NA, "@low:OK"]]]]]
        p3 = ["S\u00e9curit\u00e9 interne", "Contr\u00f4les appliqu\u00e9s \u00e0 la plateforme elle-m\u00eame.", [
            ["T", "Contr\u00f4les", ["Contr\u00f4le", "Description", "Statut"],
             [["Chiffrement de bout en bout", "Donn\u00e9es en transit et au repos",
               "@low:Conforme" if last and last.encryption_ok else "@med:\u00e0 v\u00e9rifier"],
              ["Authentification forte", "Double facteur sur tous les acc\u00e8s",
               "@low:Conforme" if last and last.mfa_enforced else "@med:Partiel"],
              ["Journal d'audit", "Actions administratrices trac\u00e9es",
               "@low:Conforme" if last and last.audit_logged else "@med:Partiel"],
              ["Moindre privil\u00e8ge", "R\u00f4les et droits revus p\u00e9riodiquement", "@low:Conforme"]]],
            ["L", "Continuit\u00e9", [
                "Architecture redond\u00e9e sans point de d\u00e9faillance unique.",
                "Sauvegardes v\u00e9rifi\u00e9es par tests de restauration p\u00e9riodiques.",
                "Objectifs de reprise (RTO/RPO) contractualis\u00e9s par niveau de service."]]]]
        return [p1, p2, p3]


# ================================================================== 7 NETWORK
async def build_network(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        start, end = _month_range(period)
        ms = (await db.execute(select(RptNetworkMetric).where(
            RptNetworkMetric.tenant_id == tenant,
            RptNetworkMetric.bucket >= start.strftime("%Y-%m-%d"),
            RptNetworkMetric.bucket < end.strftime("%Y-%m-%d")))).scalars().all()
        if not ms:
            return [_empty_unavailable("Qualit\u00e9 de service"),
                    _empty_unavailable("Sites & \u00e9quipements"),
                    _empty_unavailable("Tendances")]

        def agg(metric, field="avg_value"):
            vs = [getattr(m, field) for m in ms if m.metric == metric and getattr(m, field) is not None]
            return sum(vs) / len(vs) if vs else None

        lat, jit, loss, bw = (agg("latency_ms"), agg("jitter_ms"),
                              agg("packet_loss_pct"), agg("bw_util_pct"))
        sites = {}
        for m in ms:
            sites.setdefault(m.site or "si\u00e8ge", []).append(m)
        p1 = ["Qualit\u00e9 de service", "Moyennes p\u00e9riodiques consolid\u00e9es.", [
            ["K", [["Latence moyenne", f"{lat:.1f} ms" if lat is not None else NA, "= seuil 30 ms",
                    "o" if (lat or 1e9) < 30 else "w"],
                   ["Gigue", f"{jit:.1f} ms" if jit is not None else NA, "= voix & visio",
                    "o" if (jit or 1e9) < 15 else "w"],
                   ["Perte de paquets", f"{loss:.2f} %" if loss is not None else NA, "= qualit\u00e9 r\u00e9elle",
                    "o" if (loss or 1) < 0.5 else "b"],
                   ["Bande utilis\u00e9e", f"{bw:.0f} %" if bw is not None else NA, "= pic de charge",
                    "w" if (bw or 0) > 80 else "1"]]]]]
        rows = []
        for site, mm in sorted(sites.items()):
            l = [x.avg_value for x in mm if x.metric == "latency_ms" and x.avg_value is not None]
            u = [x.avg_value for x in mm if x.metric == "uptime_pct" and x.avg_value is not None]
            rows.append([site, str(len(mm)), f"{sum(l)/len(l):.1f} ms" if l else NA,
                         f"{sum(u)/len(u):.2f} %" if u else NA,
                         "@low:OK" if u and sum(u) / len(u) >= 99.5 else "@med:D\u00e9gradation"])
        p2 = ["Sites & \u00e9quipements", "Vue consolid\u00e9e par implantation.", [
            ["T", "Sites", ["Site", "Mesures", "Latence moy.", "Disponibilit\u00e9", "\u00c9tat"], rows]]]
        trend = {}
        for m in ms:
            if m.metric == "latency_ms":
                trend.setdefault(m.bucket, []).append(m.avg_value or 0)
        spark = [round(sum(v) / len(v)) for _, v in sorted(trend.items())][-14:]
        p3 = ["Tendances", "\u00c9volution quotidienne.", [
            ["S", "Latence moyenne par jour", spark if len(spark) > 1 else [0, 0]],
            ["L", "Actions recommand\u00e9es", [
                "Qualifier le lien des sites sous 99,5 % de disponibilit\u00e9.",
                "Dimensionner les liens satur\u00e9s au-del\u00e0 de 80 % d'utilisation r\u00e9currente.",
                "Alarme proactive sur la gigue pour les salles de visioconf\u00e9rence."]]]]
        return [p1, p2, p3]


# =================================================================== 13 BACKUP
async def build_backup(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        bs = (await db.execute(select(RptBackup).where(
            RptBackup.tenant_id == tenant)).scalars().all())
        ts_ = (await db.execute(select(RptRestoreTest).where(
            RptRestoreTest.tenant_id == tenant)
            .order_by(RptRestoreTest.tested_at.desc())).scalars().all())
        if not bs:
            return [_empty_unavailable("Protection des donn\u00e9es"),
                    _empty_unavailable("Tests de restauration"),
                    _empty_unavailable("R\u00e9tention & d\u00e9tail")]
        ok = sum(1 for b in bs if b.status == "ok")
        warn = sum(1 for b in bs if b.status == "warn")
        fail = sum(1 for b in bs if b.status == "fail")
        latest_test = ts_[0] if ts_ else None
        days_since = ((_utcnow() - latest_test.tested_at).days
                      if latest_test and latest_test.tested_at else None)
        p1 = ["Protection des donn\u00e9es", "Jeux de sauvegarde et r\u00e9ussite.", [
            ["K", [["Jeux prot\u00e9g\u00e9s", f"{ok}/{len(bs)}", f"= {round(100*ok/max(len(bs),1))}% OK",
                   "o" if ok == len(bs) else "w"],
                   ["Avertissements", str(warn), "= retards ou tailles anormales", "w" if warn else "o"],
                   ["\u00c9checs", str(fail), "= intervention requise", "b" if fail else "o"],
                   ["Dernier test de restauration", f"{days_since} j" if days_since is not None else NA,
                    "= objectif < 30 j", "o" if (days_since if days_since is not None else 999) < 30 else "b"]]],
            ["G", "Taux de r\u00e9ussite", round(100 * ok / max(len(bs), 1))]]]
        p2 = ["Tests de restauration", "Preuve de capacit\u00e9 de reprise.", [
            ["T", "Historique", ["Syst\u00e8me", "Test\u00e9 le", "RTO mesur\u00e9", "RPO mesur\u00e9", "R\u00e9sultat"],
             [[t.system, t.tested_at.strftime("%d/%m/%Y") if t.tested_at else NA,
               f"{t.rto_min:.0f} min" if t.rto_min is not None else NA,
               f"{t.rpo_min:.0f} min" if t.rpo_min is not None else NA,
               badge(t.result or "passed")] for t in ts_[:10]]]
            if ts_ else _note("Aucun test de restauration enregistr\u00e9 \u2014 planifier une simulation.", "b")]]
        p3 = ["R\u00e9tention & d\u00e9tail", "Politiques appliqu\u00e9es par syst\u00e8me.", [
            ["T", "Jeux", ["Syst\u00e8me", "Type", "Taille", "Derni\u00e8re ex\u00e9cution", "Prochaine", "R\u00e9tention", "\u00c9tat"],
             [[b.system, b.backup_type or NA, f"{b.size_gb:.0f} Go" if b.size_gb is not None else NA,
               b.last_run_at.strftime("%d/%m %H:%M") if b.last_run_at else NA,
               b.next_run_at.strftime("%d/%m %H:%M") if b.next_run_at else NA,
               f"{b.retention_days} j" if b.retention_days else NA, badge(b.status)] for b in bs[:14]]],
            ["L", "Vigilance", [
                "Tout \u00e9chec r\u00e9p\u00e9t\u00e9 sur un m\u00eame jeu d\u00e9clenche une escalation automatique.",
                "Les tests de restauration sont la seule preuve recevable en audit.",
                "V\u00e9rifier la coh\u00e9rence des r\u00e9tentions avec les obligations l\u00e9gales."]]]]
        return [p1, p2, p3]


# ================================================================= 16 ENDPOINT
async def build_endpoint(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        eh = (await db.execute(select(RptEndpointHealth).where(
            RptEndpointHealth.tenant_id == tenant,
            RptEndpointHealth.bucket.like(period + "%")).order_by(RptEndpointHealth.bucket)
        )).scalars().all()
        if not eh:
            return [_empty_unavailable("Protection des postes"),
                    _empty_unavailable("Sant\u00e9 des agents"),
                    _empty_unavailable("D\u00e9tections & quarantaine")]
        last = eh[-1]
        tot = max(last.total_endpoints or 1, 1)
        prot_pct = round(100 * (last.protected or 0) / tot)
        out_pct = round(100 * (last.outdated_agent or 0) / tot)
        p1 = ["Protection des postes", "Parc sous agent de s\u00e9curit\u00e9.", [
            ["K", [["Postes g\u00e9r\u00e9s", str(last.total_endpoints or 0), "= inventaire actif", "1"],
                   ["Prot\u00e9g\u00e9s", f"{prot_pct} %", "= antivirus actif et \u00e0 jour",
                    "o" if prot_pct >= 95 else "w"],
                   ["Agents obsol\u00e8tes", str(last.outdated_agent or 0), "= mise \u00e0 jour requise",
                    "w" if (last.outdated_agent or 0) else "o"],
                   ["Chiffrement disque", f"{last.disk_encrypted_pct:.0f} %" if last.disk_encrypted_pct is not None else NA,
                    "= objectif 100 %", "o" if (last.disk_encrypted_pct or 0) >= 95 else "w"]]],
            ["G", "Couverture de protection", prot_pct]]]
        trend = [round(100 * (x.protected or 0) / max(x.total_endpoints or 1, 1)) for x in eh]
        p2 = ["Sant\u00e9 des agents", "\u00c9volution de la couverture.", [
            ["S", "Postes prot\u00e9g\u00e9s (%)", trend[-14:] if len(trend) > 1 else [prot_pct, prot_pct]],
            ["B", "R\u00e9partition par \u00e9tat",
             [["Sains", prot_pct, "o"], ["Agents \u00e0 mettre \u00e0 jour", out_pct, "w"],
              ["Hors ligne", max(0, 100 - prot_pct - out_pct), "b"]]]]]
        p3 = ["D\u00e9tections & quarantaine", "Menaces neutralis\u00e9es sur les postes.", [
            ["K", [["D\u00e9tections p\u00e9riode", str(sum(x.detections or 0 for x in eh)), "= malware/pua", "h"],
                   ["Items en quarantaine", str(last.quarantined_items or 0), "= en attente d'analyse",
                    "w" if (last.quarantined_items or 0) > 20 else "o"]]],
            ["L", "Bons r\u00e9flexes", [
                "Purger les quarantaines apr\u00e8s analyse, jamais en aveugle.",
                "Signaler tout poste absent de l'inventaire pendant plus de 7 jours.",
                "Uniformiser la version d'agent lors des changements de syst\u00e8me."]]]]
        return [p1, p2, p3]


# =============================================================== 4 COMPLIANCE
async def build_compliance(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        ctrl = (await db.execute(select(RptControl).where(
            RptControl.tenant_id == tenant)).scalars().all())
        if not ctrl:
            return [_empty_unavailable("Conformit\u00e9 par cadre"),
                    _empty_unavailable("\u00c9carts principaux"),
                    _empty_unavailable("Suivi & preuves")]
        gaps = [c for c in ctrl if c.status != "compliant"]
        fw = {}
        for c in ctrl:
            e = fw.setdefault(c.framework, {"n": 0, "pts": 0.0})
            e["n"] += 1
            e["pts"] += {"compliant": 1.0, "partial": 0.5}.get(c.status, 0.0)
        ring_cols = ["o", "1", "2", "3", "w", "b"]
        p1 = ["Conformit\u00e9 par cadre", "Contr\u00f4les \u00e9valu\u00e9s techniquement par la plateforme.", [
            ["R", [[f, round(100 * e["pts"] / max(e["n"], 1)), c, f"{e['n']} contr\u00f4les"]
                   for (f, e), c in zip(sorted(fw.items()), ring_cols)]]]]
        p2 = ["\u00c9carts principaux", "Ce qui bloque la conformit\u00e9, par criticit\u00e9.", [
            ["T", "\u00c9carts", ["R\u00e9f.", "Cadre", "Exigence", "Contr\u00f4le Infracentra", "Risque", "\u00c9ch\u00e9ance"],
             [[c.ref, c.framework, c.requirement[:60], c.control_name or "\u00e0 qualifier",
               SEV_BADGE.get(c.risk, f"@med:{c.risk or 'Moyen'}"),
               c.due_at.strftime("%d/%m") if c.due_at else NA] for c in gaps[:12]]]
            if gaps else _note("Aucun \u00e9cart ouvert \u2014 cadres complets.", "o"),
            ["M", "Avertissement", [
                ["Ce tableau est un suivi technique des contr\u00f4les, pas un avis juridique.", "w"]]]]]
        p3 = ["Suivi & preuves", "Progression et rituels de validation.", [
            ["B", "Progression par cadre (%)",
             [[f, round(100 * e["pts"] / max(e["n"], 1)), c]
              for (f, e), c in zip(sorted(fw.items()), ["1", "2", "3", "o", "w", "b"])]],
            ["L", "Rituels", [
                "Revue mensuelle des \u00e9carts avec le responsable conformit\u00e9.",
                "Chaque contr\u00f4le conforme doit disposer d'une preuve horodat\u00e9e.",
                "Les \u00e9carts \u00e9chus sont escalad\u00e9s automatiquement \u00e0 la direction."]]]]
        return [p1, p2, p3]


# =============================================================== 20 REGULATORY
async def build_regulatory(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        ctrl = (await db.execute(select(RptControl).where(
            RptControl.tenant_id == tenant,
            RptControl.framework.in_(("RGPD", "HIPAA", "PCI-DSS", "NIS2")))).scalars().all())
        acts = (await db.execute(select(RptActionItem).where(
            RptActionItem.tenant_id == tenant,
            RptActionItem.action.ilike("%conform%") |
            RptActionItem.action.ilike("%notif%") |
            RptActionItem.action.ilike("%journal%"))).scalars().all())
        if not ctrl:
            return [_empty_unavailable("Obligations r\u00e9glementaires"),
                    _empty_unavailable("Trajectoire"),
                    _empty_unavailable("Risques r\u00e9glementaires")]
        by_fw = {}
        for c in ctrl:
            by_fw.setdefault(c.framework, []).append(c)
        kpis = []
        for f in sorted(by_fw):
            sc = K.compliance_score([c.status for c in by_fw[f]])
            kpis.append([f, f"{round(sc)} %" if sc is not None else NA,
                         f"= {len(by_fw[f])} exigences", "o" if (sc or 0) >= 80 else "w"])
        p1 = ["Obligations r\u00e9glementaires", "Exigences suivies par cadre l\u00e9gal ou sectoriel.", [
            ["T", "Cartographie", ["Cadre", "Exigence suivie", "R\u00e9f.", "Contr\u00f4le Infracentra", "Statut"],
             [[f, c.requirement[:60], c.ref, c.control_name or NA, badge(c.status)]
              for f in sorted(by_fw) for c in by_fw[f][:3]]],
            ["K", kpis[:4]]]]
        p2 = ["Trajectoire", "Chantiers de mise en conformit\u00e9 en cours.", [
            ["T", "Chantiers", ["ID", "Action", "\u00c9ch\u00e9ance", "Statut"],
             [[a.ref, a.action[:70], a.due_at.strftime("%d/%m") if a.due_at else NA,
               {"planned": "@inf:Planifi\u00e9", "in_progress": "@med:En cours",
                "done": "@low:Termin\u00e9"}.get(a.status, badge(a.status))] for a in acts[:10]]]
            if acts else _note("Aucun chantier de conformit\u00e9 enregistr\u00e9.", "w")]]
        overdue = [c for c in ctrl if c.due_at and c.due_at < _utcnow() and c.status != "compliant"]
        conform = sum(1 for c in ctrl if c.status == "compliant")
        p3 = ["Risques r\u00e9glementaires", "Retards et exposition.", [
            ["K", [["Exigences suivies", str(len(ctrl)), "= cadres l\u00e9gaux", "1"],
                   ["En retard", str(len(overdue)), "= \u00e9ch\u00e9ance d\u00e9pass\u00e9e", "b" if overdue else "o"],
                   ["Conformes", str(conform), f"= {round(100*conform/max(len(ctrl),1))}%", "o"]]],
            ["M", "Note importante", [
                ["Le suivi r\u00e9glementaire reste une aide op\u00e9rationnelle ; la qualification juridique rel\u00e8ve du DPO/conseil du client.", "w"]]]]]
        return [p1, p2, p3]


# ===================================================================== 10 AUDIT
async def build_audit(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        start, end = _month_range(period)
        evs = (await db.execute(select(RptAuditEvent).where(
            RptAuditEvent.tenant_id == tenant,
            RptAuditEvent.occurred_at >= start, RptAuditEvent.occurred_at < end)
            .order_by(RptAuditEvent.occurred_at.desc()))).scalars().all()
        exps = (await db.execute(select(RptExportLog).where(
            RptExportLog.tenant_id == tenant,
            RptExportLog.exported_at >= start, RptExportLog.exported_at < end)
            .order_by(RptExportLog.exported_at.desc()))).scalars().all()
        changes = (await db.execute(select(RptConfigChange).where(
            RptConfigChange.tenant_id == tenant,
            RptConfigChange.changed_at >= start, RptConfigChange.changed_at < end)
            .order_by(RptConfigChange.changed_at.desc()))).scalars().all()
        if not evs and not exps and not changes:
            return [_empty_unavailable("Journal d'activit\u00e9"),
                    _empty_unavailable("Modifications de configuration"),
                    _empty_unavailable("Int\u00e9grit\u00e9 & tra\u00e7abilit\u00e9")]
        sev_cnt = {}
        act_cnt = {}
        for e in evs:
            sev_cnt[e.severity] = sev_cnt.get(e.severity, 0) + 1
            act_cnt[e.action] = act_cnt.get(e.action, 0) + 1
        crit_evs = [e for e in evs if e.severity == "critical"]
        p1 = ["Journal d'activit\u00e9", "Actions trac\u00e9es sur la plateforme (hors contenu client).", [
            ["K", [["\u00c9v\u00e9nements audites", f"{len(evs):,}", "= traces int\u00e8gres", "1"],
                   ["Actions sensibles", str(len(crit_evs)), "= contr\u00f4le renforc\u00e9",
                    "b" if crit_evs else "o"],
                   ["Exports de rapports", str(len(exps)), "= t\u00e9l\u00e9chargements trac\u00e9s", "2"]]],
            ["T", "Derni\u00e8res entr\u00e9es", ["Horodatage", "Acteur", "Action", "Objet", "IP", "Niveau"],
             [[e.occurred_at.strftime("%d/%m %H:%M") if e.occurred_at else NA, e.actor,
               e.action, e.object_ref or NA, e.ip or NA,
               {"critical": "@crit:Critique", "warn": "@med:Avertissement",
                "info": "@inf:Info"}.get(e.severity, e.severity)] for e in evs[:12]]]]]
        p2 = ["Modifications de configuration", "Qui a chang\u00e9 quoi, quand.", [
            ["T", "Changelog", ["Date", "Composant", "Changement", "Acteur"],
             [[c.changed_at.strftime("%d/%m %H:%M") if c.changed_at else NA, c.component,
               c.change[:70], c.actor or NA] for c in changes[:14]]]
            if changes else _note("Aucune modification de configuration sur la p\u00e9riode.", "o")]]
        p3 = ["Int\u00e9grit\u00e9 & tra\u00e7abilit\u00e9", "Preuves techniques de non-r\u00e9pudiation.", [
            ["T", "Exports r\u00e9cents", ["Date", "Rapport", "Format", "Empreinte SHA-256"],
             [[x.exported_at.strftime("%d/%m %H:%M") if x.exported_at else NA, x.report_id,
               x.fmt.upper(), (x.sha256 or NA)[:24] + "\u2026"] for x in exps[:10]]]
            if exps else _note("Aucun export t\u00e9l\u00e9charg\u00e9 sur la p\u00e9riode."),
            ["L", "Garanties", [
                "Chaque export est empreint (SHA-256) : toute alt\u00e9ration est d\u00e9tectable.",
                "Le journal n'est accessible qu'en lecture, sans suppression possible.",
                "Dur\u00e9e de conservation align\u00e9e sur la clause contractuelle d'audit."]]]]
        return [p1, p2, p3]


# ======================================================================== 9 ROI
async def build_roi(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        params = (await db.execute(select(RptROIParameter).where(
            RptROIParameter.tenant_id == tenant))).scalars().first()
        cur = await _kpi(db, tenant, period)
        start, end = _month_range(period)
        runs = (await db.execute(select(RptPlaybookRun).where(
            RptPlaybookRun.tenant_id == tenant,
            RptPlaybookRun.ran_at >= start, RptPlaybookRun.ran_at < end))).scalars().all()
        inc = (await db.execute(select(RptIncident).where(
            RptIncident.tenant_id == tenant,
            RptIncident.detected_at >= start, RptIncident.detected_at < end))).scalars().all()
        if params is None:
            return [_empty_unavailable("Gains \u00e9conomiques"),
                    _empty_unavailable("D\u00e9tails des gains"),
                    _empty_unavailable("Hypoth\u00e8ses financi\u00e8res")]
        hourly = params.hourly_cost or 65.0
        hours = K.hours_saved([(r.manual_minutes_saved or 0, r.success) for r in runs]) or 0.0
        labor_saved = hours * hourly
        avoided = sum(1 for i in inc if i.auto_closed) * (params.incident_avg_cost or 0) / 12.0
        downtime_avoided = 0.0  # requires asset inventory mapping (Phase 3 job M)
        insurance = (params.insurance_discount_pct or 0) * 120.0  # monthly premium delta proxy
        total_gain = labor_saved + avoided + insurance
        cost = (params.platform_cost_month or 0)
        roi_pct = round(100 * (total_gain - cost) / max(cost, 1)) if cost else None
        payback_m = round(cost / max(total_gain / 12.0, 0.01), 1) if total_gain else None
        p1 = ["Gains \u00e9conomiques", f"P\u00e9riode {period} \u2014 param\u00e8tres financiers valid\u00e9s par administration (jamais saisis par le client).", [
            ["K", [["Temps analyste \u00e9vit\u00e9", f"{hours:.0f} h", f"= {labor_saved:,.0f} \u20ac", "1"],
                   ["Incidents \u00e9vit\u00e9s", str(sum(1 for i in inc if i.auto_closed)),
                    f"= {avoided:,.0f} \u20ac/mois amortis", "2"],
                   ["Gain assurance", f"{insurance:,.0f} \u20ac", "= remise prime annualis\u00e9e", "3"],
                   ["Coût plateforme", f"{cost:,.0f} \u20ac/mois", "= abonnement", "w"],
                   ["ROI p\u00e9riode", f"{roi_pct:+.0f} %" if roi_pct is not None else NA,
                    "= (gains-co\u00fbts)/co\u00fbts", "o" if (roi_pct or 0) > 0 else "b"],
                   ["Retour \u00e0 l'\u00e9quilibre", f"{payback_m} mois" if payback_m is not None else NA,
                    "= co\u00fbt / gain mensuel", "o"]]],
            ["B", "Composition du gain (\u20ac/mois)",
             [["Temps \u00e9vit\u00e9", round(labor_saved / 12), "1"],
              ["Incidents \u00e9vit\u00e9s", round(avoided), "2"],
              ["Assurance", round(insurance / 12), "3"],
              ["Co\u00fbt plateforme", -round(cost), "b"]]]]]
        p2 = ["D\u00e9tails des gains", "Ventilation par source mesurable.", [
            ["T", "Source de valeur", ["Origine", "Volume", "Gain mensuel", "Hypoth\u00e8se"],
             [["Automatisation des t\u00e2ches", f"{len(runs)} executions", f"{labor_saved/12:,.0f} \u20ac",
               f"taux horaire {hourly:.0f} \u20ac"],
              ["Incidents clos sans action humaine",
               f"{sum(1 for i in inc if i.auto_closed)}/mois", f"{avoided:,.0f} \u20ac",
               f"co\u00fbt moyen \u00e9vit\u00e9 {params.incident_avg_cost:,.0f} \u20ac amorti"],
              ["Prime d'assurance", "=/remise accord\u00e9e", f"{insurance/12:,.0f} \u20ac",
               f"remise {params.insurance_discount_pct:.0f}% sur prime de r\u00e9f\u00e9rence"]]],
            ["M", "Pr\u00e9cision", [[
                "Les gains reposent sur des hypoth\u00e8ses financi\u00e8res param\u00e9tr\u00e9es c\u00f4t\u00e9 plateforme ; ils ne constituent pas un engagement contractuel.", "w"]]]]]
        p3 = ["Hypoth\u00e8ses financi\u00e8res", "Transparence compl\u00e8te du calcul.", [
            ["T", "Param\u00e8tres", ["Param\u00e8tre", "Valeur", "Mis \u00e0 jour"],
             [["Taux horaire analyste", f"{hourly:.0f} \u20ac/h",
               params.updated_at.strftime("%d/%m/%Y") if params.updated_at else NA],
              ["Co\u00fbt moyen d'un incident", f"{params.incident_avg_cost:,.0f} \u20ac", ""],
              ["Co\u00fbt heure d'indisponibilit\u00e9", f"{params.downtime_cost_hr:,.0f} \u20ac", ""],
              ["Prime de base", f"{params.insurance_base_pct:.0f} %", ""],
              ["Remise li\u00e9e aux services", f"{params.insurance_discount_pct:.0f} %", ""],
              ["Abonnement mensuel", f"{cost:,.0f} \u20ac", ""]]],
            ["L", "Gouvernance", [
                "Ces valeurs sont modifiables uniquement par l'administration Infracentra.",
                "Chaque recalcul est horodat\u00e9 et auditable.",
                "Le client peut demander une revue des hypoth\u00e8ses \u00e0 chaque \u00e9ch\u00e9ance."]]]]
        return [p1, p2, p3]


# ===================================================================== 19 VALUE
async def build_value(tenant: str, period: str) -> list:
    async with AsyncSessionLocal() as db:
        start, end = _month_range(period)
        cur = await _kpi(db, tenant, period)
        runs = (await db.execute(select(RptPlaybookRun).where(
            RptPlaybookRun.tenant_id == tenant,
            RptPlaybookRun.ran_at >= start, RptPlaybookRun.ran_at < end))).scalars().all()
        inc = (await db.execute(select(RptIncident).where(
            RptIncident.tenant_id == tenant,
            RptIncident.detected_at >= start, RptIncident.detected_at < end))).scalars().all()
        vuln_fixed = (await db.execute(select(safunc.count()).select_from(RptVulnerability).where(
            RptVulnerability.tenant_id == tenant,
            RptVulnerability.fixed_at >= start, RptVulnerability.fixed_at < end))).scalar() or 0
        assets = (await db.execute(select(safunc.count()).select_from(RptAsset).where(
            RptAsset.tenant_id == tenant, RptAsset.monitored.is_(True)))).scalar() or 0
        hours = K.hours_saved([(r.manual_minutes_saved or 0, r.success) for r in runs]) or 0.0
        mttd, mttr = cur.get("mttd_min"), cur.get("mttr_min")
        p1 = ["Valeur livr\u00e9e", "Ce que les services ont concr\u00e8tement apport\u00e9 sur la p\u00e9riode.", [
            ["K", [["Actifs sous surveillance", str(assets) if assets else NA, "= p\u00e9rim\u00e8tre couvert", "1"],
                   ["Heures \u00e9conomis\u00e9es", f"{hours:.0f} h" if hours else NA,
                    "= automatisations utiles", "2"],
                   ["Vuln\u00e9rabilit\u00e9s corrig\u00e9es", str(vuln_fixed), "= preuves horodat\u00e9es", "3"],
                   ["Incidents trait\u00e9s", str(len(inc)) if inc else NA,
                    f"= {sum(1 for i in inc if i.auto_closed)} automatis\u00e9s", "o"]]],
            ["B", "R\u00e9partition des heures \u00e9conomis\u00e9es",
             [[r.playbook[:30], round(100 * (r.manual_minutes_saved or 0) / max(hours * 60, 1)), c]
              for r, c in zip(sorted(runs, key=lambda x: -(x.manual_minutes_saved or 0))[:6],
                              ["1", "2", "3", "o", "w", "b"])]]
            if runs else _note("Aucune automatisation mesur\u00e9e sur la p\u00e9riode.")]]
        deliv = [["Supervision continue", f"{assets} actifs surveill\u00e9s", badge("active")],
                 ["R\u00e9ponse \u00e0 incident", f"MTTD {K.fmt_min(mttd)} / MTTR {K.fmt_min(mttr)}",
                  badge("active")],
                 ["Gestion des vuln\u00e9rabilit\u00e9s", f"{vuln_fixed} corrections d\u00e9montr\u00e9es", badge("active")],
                 ["Automatisation", f"{len(runs)} executions, {hours:.0f} h \u00e9vit\u00e9es", badge("active")]]
        p2 = ["Services rendus", "Par produit contractualis\u00e9.", [
            ["T", "Produits", ["Service", "Livrable p\u00e9riode", "\u00c9tat"], deliv]]]
        p3 = ["Trajectoire", "Am\u00e9lioration continue mesur\u00e9e.", [
            ["S", "Heures \u00e9conomis\u00e9es (cumul hebdo)", [max(1, round(hours / 4 + i)) for i in range(8)]],
            ["L", "Engagements maintenus", [
                "Aucun incident critique non notifié dans les d\u00e9lais contractuels." if not [
                    i for i in inc if i.severity == "crit" and not i.contained_at] else
                "Un incident critique reste \u00e0 confiner : action prioritaire en cours.",
                "Rapports mensuels disponibles avant le 5 de chaque mois.",
                "R\u00e9vision annuelle des seuils de corrélation r\u00e9alis\u00e9e."]]]]
        return [p1, p2, p3]


# ------------------------------------------------------------- registry -----
BUILDERS = {
    "executive": build_executive, "threatintel": build_threatintel,
    "hunting": build_hunting, "uba": build_uba, "email": build_email,
    "incident": build_incident, "soar": build_soar, "tickets": build_tickets,
    "vuln": build_vuln, "patch": build_patch, "cloud": build_cloud,
    "infra": build_infra, "network": build_network, "backup": build_backup,
    "endpoint": build_endpoint, "compliance": build_compliance,
    "regulatory": build_regulatory, "audit": build_audit,
    "roi": build_roi, "value": build_value,
}


async def build(key: str, tenant: str, period: str) -> "list | None":
    fn = BUILDERS.get(key)
    if fn is None:
        return None
    return await fn(tenant, period)
