// ---------------------------------------------------------------------------
// Partner Portal — Demo Mode handlers for Phase 2 (partners_ops.py) and
// Phase 3 (partners_commercial.py). Injected into demoStore.handle() at the
// top of the `root === 'partners'` block. Shapes mirror the FastAPI routers
// exactly; tenant isolation & role rules match the backend (cross-partner →
// 403, non-approved deal bonus → 409, delete-before-disable → 409...).
// Money: MAD only (canonical pricing_config values via PRICING_CONFIG_V2).
// ---------------------------------------------------------------------------
import { partners } from '../data/partnerWorld';
// Demo operational feeds live in demoMode.ts (single source of truth); they are
// injected here via installPartnerOpsHandlers deps to avoid a circular import.
import { alerts, tickets, incidents } from './demoOpsFeeds';
import { quote, partnerTierFor } from './pricingEngine';
import { PRICING_CONFIG_V2 } from '../data/pricingConfig';

type Handler = <T>(path: string, method: string, body: any) => Promise<T>;

const nowIso = () => new Date().toISOString();
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60000);

export function installPartnerOpsHandlers(deps: {
  httpErr: (status: number, msg: string) => Error;
  delay: <T>(v: T, ms?: number) => Promise<T>;
  demoSession: () => { role?: string; orgId?: string | null; email?: string };
}): Handler {
  const { httpErr, delay, demoSession } = deps;

  // per-session mutable stores (reset on page reload — same as other demo stores)
  const handovers: Record<string, any[]> = {};
  const templates: Record<string, Record<string, any>> = {};
  const enrollments: Record<number, any> = {};        // clientNumId -> enrollment
  const deals: any[] = [];
  const quotes: any[] = [];
  let dealSeq = 1, quoteSeq = 1;

  const childNum = (c: any) => Number(String(c.id).replace(/\D+$/, '').slice('ec-'.length)) ||
    (parseInt(String(c.id).split('-').pop() ?? '0', 10) || 0);

  async function h<T>(path: string, method: string, b: any): Promise<T> {
    const s = demoSession();
    const isPlatform = s.role === 'platform_admin';
    const callerPid = s.role === 'partner_admin' ? String(s.orgId ?? '') : null;

    const parts = path.split('/').filter(Boolean);   // ['partners', pid, ...]
    if (parts[0] !== 'partners') throw httpErr(404, 'partner-ops: bad root');

    // GET /partners/deals/conflicts (platform admin queue)
    if (parts[1] === 'deals' && parts[2] === 'conflicts') {
      if (!isPlatform) throw httpErr(403, 'Platform-admin only');
      return delay({ conflicts: deals.filter(d => d.status === 'conflict') }) as unknown as T;
    }

    const pid = parts[1];
    const partner = partners.find(p => p.id === pid);
    if (!partner) throw httpErr(404, `Demo: partner ${pid} not found`);
    if (!isPlatform && pid !== callerPid) throw httpErr(403, 'Cross-partner access denied');

    const kids = partner.end_clients;
    const kidByNum = (n: number) => kids.find(c => childNum(c) === n);
    const q = (name: string) => {
      const m = new RegExp(`[?&]${name}=([^&]*)`).exec(path);
      return m ? decodeURIComponent(m[1]) : undefined;
    };
    const outDeal = (d: any) => {
      const winEnd = d.approved_at ? addMin(new Date(d.approved_at), 365 * 24 * 60).toISOString() : null;
      const expired = d.approved_at && new Date(winEnd!) < new Date();
      const state = d.status === 'won' ? 'won' : d.status === 'rejected' ? 'rejected'
        : expired ? 'expired' : d.status;
      const bonusOpen = d.status === 'approved' && !expired;
      return { ...d, state, bonus_window_open: bonusOpen, bonus_points: bonusOpen ? 15 : 0, bonus_window_ends: winEnd };
    };

    const sub = parts.slice(2).join('/').replace(/\?.*$/, '');

    // ======================= PHASE 2 =========================================
    if (sub.startsWith('queue') || sub === 'handovers' || sub.startsWith('handovers')
      || sub === 'health' || sub.startsWith('impersonations') || sub.startsWith('templates')) {

      if (sub === 'queue' && method === 'GET') {
        const clientF = q('client') ? Number(q('client')) : undefined;
        const kind = q('kind'), sev = q('severity'), st = q('status'), sla = q('sla'), txt = (q('q') ?? '').toLowerCase();
        const scoped = (o: number) => kids.some(c => childNum(c) === o);
        const nameOf = (o: number) => kids.find(c => childNum(c) === o)?.name ?? '';
        const rank: Record<string, number> = { critical: 0, p1: 0, high: 1, p2: 1, medium: 2, p3: 2, low: 3, p4: 3, info: 4 };
        const items: any[] = [];
        const counts = { alerts_open: 0, tickets_open: 0, incidents_open: 0, sla_breached: 0, total: 0 };
        const matchTxt = (x: any, fields: string[]) => !txt || fields.some(f => String(x[f] ?? '').toLowerCase().includes(txt));
        if (!kind || kind === 'alert') for (const a of alerts) {
          if (!scoped(a.org_id) || a.status === 'resolved' || a.status === 'closed') continue;
          if (clientF && a.org_id !== clientF) continue;
          if (sev && a.severity !== sev) continue;
          if (st && a.status !== st) continue;
          if (!matchTxt(a, ['title', 'resource', 'uid'])) continue;
          counts.alerts_open++;
          items.push({ kind: 'alert', uid: a.uid, org_id: a.org_id, client_name: nameOf(a.org_id), title: a.title, severity: a.severity, status: a.status, assignee: a.assignee ?? null, source: a.source, resource: a.resource ?? null, created_at: a.created_at, sla_state: 'none', sla_due_at: null });
        }
        if (!kind || kind === 'ticket') for (const t of tickets) {
          if (!scoped(t.org_id) || ['resolved', 'closed'].includes(t.status)) continue;
          if (clientF && t.org_id !== clientF) continue;
          const sevMap: Record<string, string> = { critical: 'p1', high: 'p2', medium: 'p3', low: 'p4' };
          if (sev && t.priority !== (sevMap[sev] ?? sev)) continue;
          if (st && t.status !== st) continue;
          if (!matchTxt(t, ['title', 'asset', 'uid'])) continue;
          const due = t.due_resolve_at ?? t.due_response_at;
          const breach = due ? (new Date(due) < new Date() ? 'breached' : addMin(new Date(due), -120) < new Date() ? 'at_risk' : 'ok') : 'none';
          if (breach === 'breached') counts.sla_breached++;
          counts.tickets_open++;
          items.push({ kind: 'ticket', uid: t.uid, org_id: t.org_id, client_name: nameOf(t.org_id), title: t.title, severity: t.priority, status: t.status, assignee: t.assignee ?? null, source: 'psa', resource: t.asset ?? null, created_at: t.created_at, sla_state: breach, sla_due_at: due ?? null });
        }
        if (!kind || kind === 'incident') for (const i of incidents) {
          if (!scoped(i.org_id) || ['resolved', 'closed'].includes(i.status)) continue;
          if (clientF && i.org_id !== clientF) continue;
          if (sev && i.severity !== sev) continue;
          if (st && i.status !== st) continue;
          if (!matchTxt(i, ['title', 'uid'])) continue;
          counts.incidents_open++;
          items.push({ kind: 'incident', uid: i.uid ?? `INC-${i.id}`, org_id: i.org_id, client_name: nameOf(i.org_id), title: i.title, severity: i.severity, status: i.status, assignee: i.assignee ?? null, source: 'soc', resource: null, created_at: (i as any).created_at ?? nowIso(), sla_state: 'none', sla_due_at: null });
        }
        items.sort((x, y) => (rank[x.severity] ?? 9) - (rank[y.severity] ?? 9) || String(y.created_at).localeCompare(String(x.created_at)));
        let filtered = items;
        if (sla) filtered = items.filter(it => it.sla_state === sla);
        counts.total = filtered.length;
        return delay({
          items: filtered.slice(0, 100), counts,
          clients: kids.map(c => ({ id: childNum(c), name: c.name })),
        }) as unknown as T;
      }

      if (sub === 'queue/assign' && method === 'POST') {
        const teamEmails = new Set([partner.contact_email, ...(kids.length ? [partner.contact_email] : [])]);
        // partner "team" in demo = own contact + any assignee already on their tickets
        for (const t of tickets) if (scopedOrg(partner, t.org_id) && t.assignee) teamEmails.add(t.assignee);
        function scopedOrg(p: any, oid: number) { return p.end_clients.some(c => childNum(c) === oid); }
        if (!teamEmails.has(b.assignee_email)) throw httpErr(422, 'assignee must belong to the partner team');
        const store: any = { alert: alerts, ticket: tickets, incident: incidents }[b.kind as 'alert'];
        const row = store.find((x: any) => x.uid === b.item_uid);
        if (!row || !scopedOrg(partner, row.org_id)) throw httpErr(404, "item not found in this partner's tenants");
        row.assignee = b.assignee_email;
        return delay({ ok: true, uid: b.item_uid, assignee: b.assignee_email }) as unknown as T;
      }

      if (sub === 'handovers') {
        if (method === 'GET') return delay(handovers[pid] ?? []) as unknown as T;
        if (method === 'POST') {
          if (!['morning', 'afternoon', 'night'].includes(b.shift)) throw httpErr(422, 'shift invalide');
          if (!b.content || String(b.content).trim().length < 3) throw httpErr(422, 'content ≥ 3 caractères');
          const note = { id: `HVO-${Math.random().toString(16).slice(2, 10)}`, shift: b.shift, content: String(b.content).trim(), author: s.email ?? partner.contact_email, created_at: nowIso() };
          handovers[pid] = [note, ...(handovers[pid] ?? [])].slice(0, 100);
          return delay(note) as unknown as T;
        }
      }

      if (sub === 'health' && method === 'GET') {
        const now = new Date();
        const rows = kids.map(c => {
          const oid = childNum(c);
          const oa = alerts.filter(a => a.org_id === oid && !['resolved', 'closed'].includes(a.status));
          const ot = tickets.filter(t => t.org_id === oid && !['resolved', 'closed'].includes(t.status));
          const oi = incidents.filter(i => i.org_id === oid && !['resolved', 'closed'].includes(i.status));
          const overdue = ot.filter(t => (t.due_resolve_at && new Date(t.due_resolve_at) < now) || (t.due_response_at && !t.first_response_at && new Date(t.due_response_at) < now)).length;
          const al = { critical: oa.filter(a => a.severity === 'critical').length, high: oa.filter(a => a.severity === 'high').length, other: oa.filter(a => a.severity !== 'critical' && a.severity !== 'high').length };
          const score = al.critical * 10 + al.high * 4 + al.other + overdue * 3 + oi.length * 5;
          const agentsTotal = Math.max(1, Math.round(c.devices * 0.9));
          return {
            client_org_id: oid, name: c.name, status: c.status, open_alerts: al,
            open_incidents: oi.length, open_tickets: ot.length, overdue_tickets: overdue,
            sla_state: overdue ? 'breached' : ot.length ? 'at_risk' : 'ok',
            agents_total: agentsTotal, agents_online: Math.max(0, agentsTotal - (overdue > 0 ? 2 : 0)),
            risk_score: score, risk_level: score >= 30 ? 'critical' : score >= 15 ? 'high' : score >= 5 ? 'medium' : 'low',
          };
        }).sort((a, z) => z.risk_score - a.risk_score);
        return delay({ clients: rows, generated_at: nowIso() }) as unknown as T;
      }

      if (sub === 'impersonations') {
        if (method === 'POST') {
          const target = kidByNum(Number(b.client_org_id));
          if (!target) throw httpErr(403, 'Cross-partner access denied');
          const minutes = Math.min(240, Math.max(5, Number(b.minutes ?? 30)));
          if (!b.reason || String(b.reason).trim().length < 5) throw httpErr(422, 'reason ≥ 5 caractères');
          const token = `demo-pcs.${btoa(JSON.stringify({ sub: s.email, act_as_org: childNum(target), scope: 'partner_console' }))}.sig`;
          return delay({ token, client_org_id: childNum(target), client_name: target.name, expires_at: addMin(new Date(), minutes).toISOString(), minutes }) as unknown as T;
        }
        if (method === 'DELETE') return delay({ revoked: 1 }) as unknown as T;
      }

      if (sub === 'templates' && method === 'GET') {
        return delay(Object.values(templates[pid] ?? {})) as unknown as T;
      }
      const tplM = /^templates\/([\w-]+)$/.exec(sub);
      if (tplM && method === 'PUT') {
        const tid = tplM[1];
        if (!tid || tid.length > 40) throw httpErr(422, 'identifiant de template invalide');
        const lib = templates[pid] ??= {};
        lib[tid] = { id: tid, name: b.name, monitoring_rules: (b.monitoring_rules ?? []).slice(0, 50), notification_rules: (b.notification_rules ?? []).slice(0, 50), playbooks: (b.playbooks ?? []).slice(0, 25), updated_at: nowIso() };
        return delay(lib[tid]) as unknown as T;
      }
      const tplApply = /^templates\/([\w-]+)\/apply$/.exec(sub);
      if (tplApply && method === 'POST') {
        const tpl = (templates[pid] ?? {})[tplApply[1]];
        if (!tpl) throw httpErr(404, 'template not found');
        const ids: number[] = b.target_client_ids ?? [];
        if (!ids.every(id => kidByNum(id))) throw httpErr(403, 'Cross-partner access denied');
        return delay({ applied: { monitoring_rules: tpl.monitoring_rules.length * ids.length, notification_rules: tpl.notification_rules.length * ids.length, playbooks: tpl.playbooks.length * ids.length }, clients: ids }) as unknown as T;
      }
    }

    // ======================= PHASE 3 =========================================
    const onbM = /^clients\/(\d+)\/onboarding$/.exec(sub);
    if (onbM && method === 'POST') {
      const child = kidByNum(Number(onbM[1]));
      if (!child) throw httpErr(404, 'Client not found for this partner');
      if (!['starter', 'pro', 'souverain'].includes(b.pack)) throw httpErr(422, 'pack invalide');
      const cfgPack = (PRICING_CONFIG_V2.packs as any)[b.pack];
      const token = `enr-demo-${Math.random().toString(36).slice(2, 18)}`;
      enrollments[childNum(child)] = { pack: b.pack, contract_months: b.contract_months ?? 12, created_at: nowIso(), used: false };
      return delay({
        client_org_id: childNum(child), pack: b.pack,
        pack_summary: { price_mad: cfgPack.price, min_units: cfgPack.minUnits, siem_retention_days: cfgPack.retentionDays, backup_quota_gb_per_unit: cfgPack.backupQuotaGbPerUnit, support: cfgPack.support },
        agent_installer: `curl -fsSL https://agents.infracentra.ma/install.sh | sudo bash -s -- --token ${token} --server https://soc.infracentra.ma`,
        enrollment_token: token,
        invite: { sent: !!b.admin_email, email: b.admin_email ?? null },
        integrations: b.integrations ?? [],
        next_steps: ['Run installer on first host', 'Verify agent online in console', 'Import golden templates (Phase 2 library)'],
      }) as unknown as T;
    }

    const offM = /^clients\/(\d+)\/offboarding(\/disable)?$/.exec(sub);
    if (offM) {
      const child = kidByNum(Number(offM[1]));
      const cid = Number(offM[1]);
      if (!child) throw httpErr(404, 'Client not found for this partner');
      if (!offM[2] && method === 'GET') {
        return delay({
          client_org_id: cid, name: child.name,
          export: { organization: { id: cid, name: child.name, status: child.status, asset_count: child.devices, seat_limit: child.users, monthly_revenue: child.monthly_mrr_mad }, settings_keys: ['branding', 'billing'], counts: { alerts: alerts.filter(a => a.org_id === cid).length, tickets: tickets.filter(t => t.org_id === cid).length, incidents: incidents.filter(i => i.org_id === cid).length } },
          options: [{ action: 'disable', effect: 'agents stop reporting; data retained 90 days' }, { action: 'delete', effect: 'hard delete — requires disable first' }],
        }) as unknown as T;
      }
      if (offM[2] === 'disable' && method === 'POST') { child.status = 'disabled'; return delay({ client_org_id: cid, status: 'disabled' }) as unknown as T; }
      if (!offM[2] && method === 'DELETE') {
        if (child.status !== 'disabled') throw httpErr(409, 'Disable the client before deleting it');
        const idx = kids.indexOf(child); kids.splice(idx, 1);
        return delay({ deleted: cid }) as unknown as T;
      }
    }

    if (sub === 'deals') {
      if (method === 'GET') return delay({ deals: deals.filter(d => d.partner_org_id === pid).map(outDeal) }) as unknown as T;
      if (method === 'POST') {
        const norm = (x: string) => x.toLowerCase().replace(/\b(sarl|sa|sas|sarlau|ltd|inc)\b/g, '').replace(/[^a-z0-9]/g, '');
        const active = deals.filter(d => ['registered', 'approved', 'conflict'].includes(d.status));
        const clashForeign = active.filter(d => d.partner_org_id !== pid && norm(d.prospect_company) === norm(b.prospect_company));
        const clashOwn = active.filter(d => d.partner_org_id === pid && norm(d.prospect_company) === norm(b.prospect_company));
        if (clashOwn.length) throw httpErr(409, `A deal for this company already exists (#${clashOwn[0].id})`);
        const d = {
          id: dealSeq++, partner_org_id: pid, prospect_company: String(b.prospect_company).trim(),
          prospect_email: b.prospect_email ?? null, expected_units: String(b.expected_units),
          pack: b.pack ?? null, status: clashForeign.length ? 'conflict' : 'registered',
          conflict_note: clashForeign.length ? `Conflicts with active deal(s) of partner org(s) [${[...new Set(clashForeign.map(x => x.partner_org_id))].sort()}]` : null,
          approved_at: null, created_at: nowIso(),
        };
        deals.push(d);
        return delay(outDeal(d)) as unknown as T;
      }
    }
    const dealDec = /^deals\/(\d+)\/(approve|reject)$/.exec(sub);
    if (dealDec && method === 'POST') {
      if (!isPlatform) throw httpErr(403, 'Only the vendor can approve deal registrations');
      const d = deals.find(x => x.id === Number(dealDec[1]) && x.partner_org_id === pid);
      if (!d) throw httpErr(404, 'Deal not found');
      if (!['registered', 'conflict'].includes(d.status)) throw httpErr(409, `Deal is ${d.status}; cannot ${dealDec[2]}`);
      d.status = dealDec[2] === 'approve' ? 'approved' : 'rejected';
      if (d.status === 'approved') d.approved_at = nowIso();
      return delay(outDeal(d)) as unknown as T;
    }

    if (sub === 'quotes') {
      if (method === 'GET') return delay({ quotes: quotes.filter(x => x._pid === pid).map(({ _pid, ...rest }: any) => rest) }) as unknown as T;
      if (method === 'POST') {
        const unitsIn: any[] = b.assets ?? [];
        const tier = partnerTierFor(PRICING_CONFIG_V2, kids.reduce((a, c) => a + c.devices, 0));
        const inputs: any = { mode: b.mode ?? 'pack', pack: b.pack, assets: unitsIn, contractMonths: b.contract_months ?? 0, partnerTier: tier.id, siemGbDay: b.siem_gb_day ?? 0, backupVolumeGb: b.backup_volume_gb ?? 0, support247: !!b.support247 };
        const deal = b.deal_id ? deals.find(x => x.id === Number(b.deal_id) && x.partner_org_id === pid) : null;
        if (b.deal_id) {
          if (!deal) throw httpErr(404, 'Deal not found');
          if (!outDeal(deal).bonus_window_open) throw httpErr(409, `Deal is ${outDeal(deal).state} — bonus window not open`);
          inputs.dealRegisteredAt = deal.approved_at;
        }
        const result = quote(inputs as any, PRICING_CONFIG_V2);
        if (!result.eligible) throw httpErr(422, (result as any).reason ?? 'Devis non éligible');
        const wholesale = Number(result.totals.monthly_excl_vat_mad);
        let margin = null;
        if (b.retail_per_unit_mad != null) {
          const retail = Number(b.retail_per_unit_mad) * Number(result.totals.units);
          margin = { retail_per_unit_mad: Number(b.retail_per_unit_mad), retail_monthly_mad: retail, wholesale_monthly_mad: wholesale, gross_margin_mad: retail - wholesale, margin_pct: retail ? Math.round(((retail - wholesale) / retail) * 10000) / 100 : 0 };
        }
        const rec = {
          id: quoteSeq++, _pid: pid, number: `PPQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(quoteSeq).padStart(4, '0')}`,
          mode: inputs.mode, pack: b.pack ?? null, units: Number(result.totals.units),
          wholesale_monthly_excl_vat_mad: wholesale, config_version: PRICING_CONFIG_V2.version, created_at: nowIso(),
          _result: result, _inputs: inputs,
        };
        quotes.push(rec);
        return delay({ id: rec.id, number: rec.number, partner_tier: tier.id, managed_units: kids.reduce((a, c) => a + c.devices, 0), deal_bonus_applied: !!deal, quote: result, margin }) as unknown as T;
      }
    }

    if (sub === 'billing/statement' && method === 'GET') {
      const cid = Number(q('client_org_id')); const month = q('month') ?? '';
      const child = kidByNum(cid);
      if (!child) throw httpErr(404, 'Client not found for this partner');
      if (!/^\d{4}-\d{2}$/.test(month)) throw httpErr(400, 'month must be YYYY-MM');
      const enr = enrollments[cid];
      const pack = enr?.pack ?? null;
      const cfgP = pack ? (PRICING_CONFIG_V2.packs as any)[pack] : null;
      const units = child.devices;
      const base = cfgP ? cfgP.price * units : 0;
      const tier = partnerTierFor(PRICING_CONFIG_V2, kids.reduce((a, c) => a + c.devices, 0));
      const disc = Math.min(tier.discount, PRICING_CONFIG_V2.partner.totalDiscountCap);
      const line = {
        client_org_id: cid, name: child.name, pack, units,
        lines: [
          { key: 'pack', label: pack ? `Pack ${pack}` : 'Non configuré', qty: units, unit_mad: cfgP?.price ?? 0, amount_mad: base },
          { key: 'siem_overage', label: 'SIEM Go/jour au-delà du quota', qty: 0, amount_mad: 0 },
          { key: 'backup_overage', label: 'Sauvegarde au-delà du quota (blocs 100 Go)', qty: 0, amount_mad: 0 },
          { key: 'soc247', label: 'Astreinte 24/7', qty: 0, amount_mad: 0 },
        ],
        monthly_excl_vat_mad: base,
      };
      const dm = Math.round(base * disc * 100) / 100;
      return delay({ partner_org_id: partner.id, month, tier: tier.id, statement: { ...line, tier_discount_pct: disc, tier_discount_mad: dm, wholesale_mad: Math.round((base - dm) * 100) / 100, tier: tier.id } }) as unknown as T;
    }

    if (sub === 'billing/invoice' && method === 'GET') {
      const month = q('month') ?? '';
      if (!/^\d{4}-\d{2}$/.test(month)) throw httpErr(400, 'month must be YYYY-MM');
      const tier = partnerTierFor(PRICING_CONFIG_V2, kids.reduce((a, c) => a + c.devices, 0));
      const disc = Math.min(tier.discount, PRICING_CONFIG_V2.partner.totalDiscountCap);
      const clients = kids.filter(c => c.status !== 'disabled').map(c => {
        const enr = enrollments[childNum(c)];
        const cfgP = enr?.pack ? (PRICING_CONFIG_V2.packs as any)[enr.pack] : null;
        const gross = cfgP ? cfgP.price * c.devices : 0;
        const dm = Math.round(gross * disc * 100) / 100;
        return { client_org_id: childNum(c), name: c.name, pack: enr?.pack ?? null, units: c.devices, monthly_excl_vat_mad: gross, tier_discount_pct: disc, tier_discount_mad: dm, wholesale_mad: Math.round((gross - dm) * 100) / 100 };
      });
      const retail = clients.reduce((a, l) => a + l.monthly_excl_vat_mad, 0);
      const net = clients.reduce((a, l) => a + l.wholesale_mad, 0);
      const vat = Math.round(net * PRICING_CONFIG_V2.vat * 100) / 100;
      return delay({ partner_org_id: partner.id, month, tier: tier.id, currency: 'MAD', clients, retail_total_mad: Math.round(retail * 100) / 100, wholesale_total_mad: Math.round(net * 100) / 100, vat_mad: vat, total_incl_vat_mad: Math.round((net + vat) * 100) / 100 }) as unknown as T;
    }

    if (sub === 'billing/analytics' && method === 'GET') {
      const tier = partnerTierFor(PRICING_CONFIG_V2, kids.reduce((a, c) => a + c.devices, 0));
      const active = kids.filter(c => c.status !== 'disabled');
      const retail = active.reduce((a, c) => a + c.monthly_mrr_mad, 0);
      const wholesale = active.reduce((a, c) => {
        const enr = enrollments[childNum(c)];
        const cfgP = enr?.pack ? (PRICING_CONFIG_V2.packs as any)[enr.pack] : null;
        return a + (cfgP ? cfgP.price * c.devices : 0);
      }, 0) * (1 - Math.min(tier.discount, PRICING_CONFIG_V2.partner.totalDiscountCap));
      const wWholesale = Math.round(wholesale * 100) / 100;
      const margin = Math.round((retail - wWholesale) * 100) / 100;
      return delay({
        partner_org_id: partner.id, tier: tier.id, managed_units: kids.reduce((a, c) => a + c.devices, 0),
        active_clients: active.length, churned_clients: kids.length - active.length,
        retail_mrr_mad: retail, wholesale_mrr_mad: wWholesale, margin_mrr_mad: margin,
        margin_pct: retail ? Math.round((margin / retail) * 10000) / 100 : 0,
        tier_discount_pct: Math.min(tier.discount, PRICING_CONFIG_V2.partner.totalDiscountCap),
      }) as unknown as T;
    }

    throw httpErr(404, `Demo partner-ops: no handler for ${method} /${path}`);
  }
  return h;
}
