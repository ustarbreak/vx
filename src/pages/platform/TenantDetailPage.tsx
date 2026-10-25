// ---------------------------------------------------------------------------
// Platform Admin — Tenant Detail (Phase 4).
// Full page per client: Summary (plan + HQ/FILIALE badges), dedicated ticket
// creation, Services with Grant overrides (audit entitlement.updated), Devices
// with the PROBE concept, Members, API Keys, License, Activity and the full
// monitoring Rules engine.
// Demo Mode and real backend return EXACTLY the same shapes (tenantManagerApi).
// Route: /admin/tenants/:orgId
// ---------------------------------------------------------------------------
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Ticket, Server, Shield, Users, Key, FileText, Activity, Zap, Loader2, PlusCircle, Trash2, Radar } from 'lucide-react';
import { tenantManagerApi, type TenantSummary, type MonitoringRuleOut, type ServiceGrantOut } from '../../services/api';
import { demoDevices, demoTechnicians } from '../../data/demoWorld';
import { serviceCatalog } from '../../data/mockData';

const TABS = ['summary', 'services', 'devices', 'members', 'api-keys', 'license', 'activity', 'rules'] as const;
type Tab = typeof TABS[number];

const planBadge: Record<string, string> = {
  STARTER: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  PRO: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  SOUVERAIN: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};
const orgTypeLabel: Record<string, string> = { HQ: 'Siège (HQ)', SUBSIDIARY: 'Filiale', AGENCY: 'Agence' };

export default function TenantDetailPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('summary');
  const [sum, setSum] = useState<TenantSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showTicket, setShowTicket] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    tenantManagerApi.summary(orgId).then(setSum).catch(e => setErr(e?.message ?? 'Chargement impossible'));
  }, [orgId]);

  if (err) return <div className="p-8 text-red-400">{err} <button onClick={() => nav('/admin/clients')} className="underline ml-2">Retour</button></div>;
  if (!sum) return <div className="flex items-center gap-3 p-8 text-[var(--ic-muted)]"><Loader2 className="w-5 h-5 animate-spin" /> Chargement du tenant…</div>;

  const numericId = String(sum.id);

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-7xl mx-auto">
      <button onClick={() => nav('/admin/clients')} className="inline-flex items-center gap-1.5 text-sm text-[var(--ic-muted)] hover:text-[var(--ic-heading)]">
        <ArrowLeft className="w-4 h-4" /> Tenant Manager
      </button>

      {/* ===================== 1. SUMMARY ===================== */}
      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-[var(--ic-heading)]">{sum.name}</h1>
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase border ${planBadge[sum.plan_tier]}`}>{sum.plan_tier}</span>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-cyan-500/10 text-cyan-400 border border-[var(--ic-border)]">{orgTypeLabel[sum.org_type]}</span>
            <span className="text-xs text-[var(--ic-muted)]">{sum.location} · Facturation {sum.billing_cycle === 'ANNUAL' ? 'annuelle (-12%)' : 'mensuelle'}</span>
          </div>
          {sum.children.length > 0 && (
            <div className="mt-2 text-xs text-[var(--ic-muted)]">Sites rattachés : {sum.children.map(c => (
              <button key={c.id} onClick={() => nav(`/admin/tenants/${c.id}`)} className="text-cyan-400 underline mr-2">{c.name} ({orgTypeLabel[c.org_type]})</button>
            ))}</div>
          )}
        </div>
        {/* ===== 2. Créer un ticket directement pour CE client ===== */}
        <button onClick={() => setShowTicket(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium">
          <Ticket className="w-4 h-4" /> Créer un ticket pour ce client
        </button>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full pt-2 border-t border-[var(--ic-border)] mt-1">
          {[
            ['Endpoints supervisés', sum.endpoints], ['Membres', sum.members],
            ['Services actifs', sum.services_active], ['Incidents ouverts', sum.open_incidents],
          ].map(([l, v]) => (
            <div key={String(l)} className="text-center">
              <div className="text-xl font-bold text-[var(--ic-heading)]">{v}</div>
              <div className="text-xs text-[var(--ic-muted)]">{l}</div>
            </div>
          ))}
        </div>
        {sum.probes.length > 0 && (
          <div className="w-full text-xs text-[var(--ic-muted)] flex items-center gap-2 flex-wrap">
            <Radar className="w-3.5 h-3.5 text-blue-400" /> Probes (agents collecteurs) :
            {sum.probes.map(p => <span key={p.id} className="font-mono text-blue-300">{p.hostname} ({p.status})</span>)}
          </div>
        )}
      </div>

      {showTicket && <TicketModal orgId={numericId} orgName={sum.name} onClose={() => setShowTicket(false)} />}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
              tab === t ? 'bg-cyan-500/10 text-cyan-400 border border-[var(--ic-border)]' : 'text-[var(--ic-muted)] hover:text-[var(--ic-heading)] hover:bg-[var(--ic-surface-2)]'}`}>
            {{ summary: Shield, services: Shield, devices: Server, members: Users, 'api-keys': Key, license: FileText, activity: Activity, rules: Zap }[t] && React.createElement((({ summary: Shield, services: Shield, devices: Server, members: Users, 'api-keys': Key, license: FileText, activity: Activity, rules: Zap } as any)[t])!, { className: 'w-4 h-4' })}
            {t}
          </button>
        ))}
      </div>

      {tab === 'summary' && <div className="text-sm text-[var(--ic-muted)] p-6 bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl">Le résumé est affiché en haut de page. Sélectionnez un onglet pour gérer le client en détail.</div>}
      {tab === 'services' && <ServicesTab orgId={numericId} />}
      {tab === 'devices' && <DevicesTab orgId={numericId} />}
      {tab === 'members' && <MembersTab orgId={numericId} />}
      {tab === 'api-keys' && <PlaceholderTab label="API Keys — création/révocation via Settings → Intégrations (existant)." />}
      {tab === 'license' && <PlaceholderTab label="License & facturation Bundle — détail complet dans Tenant Manager → colonne Invoice et /client-admin/plans." />}
      {tab === 'activity' && <PlaceholderTab label="Activity Log — journal immuable consultable dans Audit Log (chaque grant, règle et ticket créés ici y sont tracés)." />}
      {tab === 'rules' && <RulesTab orgId={numericId} />}
    </div>
  );
}

/* ---------- Ticket modal (POST /admin/tenants/:id/tickets) ---------- */
function TicketModal({ orgId, orgName, onClose }: { orgId: string; orgName: string; onClose: () => void }) {
  const [title, setTitle] = useState(''); const [prio, setPrio] = useState('P3'); const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const t = await tenantManagerApi.createTicketForClient(orgId, { title: title.trim(), priority: prio, description: desc });
      setMsg(`✅ Ticket ${t.uid} créé pour ${orgName} — visible dans le Service Desk du client.`);
      setTimeout(onClose, 1400);
    } catch (e: any) { setMsg(`⚠️ ${e?.message ?? 'Échec'}`); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-6 w-full max-w-md space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[var(--ic-heading)]">Nouveau ticket — {orgName}</h3>
        <p className="text-xs text-[var(--ic-muted)]">Le ticket est rattaché à ce client, priorisé comme une demande officielle de la plateforme et notifié selon les règles d'escalade existantes.</p>
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Titre (ex : Rotation cert TLS expirante)" className="w-full px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)]" />
        <textarea rows={2} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Contexte / détails techniques…" className="w-full px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)]" />
        <select value={prio} onChange={e => setPrio(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)]">
          {['P1', 'P2', 'P3', 'P4'].map(p => <option key={p}>{p}</option>)}
        </select>
        {msg && <p className="text-xs text-cyan-300 bg-cyan-500/10 border border-[var(--ic-border)] rounded-lg px-3 py-2">{msg}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-[var(--ic-muted)] hover:bg-[var(--ic-surface-2)]">Annuler</button>
          <button onClick={submit} disabled={busy || !title.trim()} className="px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50">{busy ? 'Création…' : 'Créer le ticket'}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Devices tab with the PROBE concept ---------- */
function DevicesTab({ orgId }: { orgId: string }) {
  const id = Number(orgId);
  const devices = demoDevices.filter(d => d.orgId === id);
  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-[var(--ic-border)] text-left text-xs text-[var(--ic-muted)]">
          <th className="px-4 py-2">Hostname</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">IP</th><th className="px-4 py-2">OS</th><th className="px-4 py-2">Statut</th><th className="px-4 py-2">Fonction</th></tr></thead>
        <tbody>
          {devices.map(d => (
            <tr key={d.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface-2)]">
              <td className="px-4 py-2.5 font-mono text-[var(--ic-heading)]">{d.hostname}</td>
              <td className="px-4 py-2.5 text-[var(--ic-muted)] capitalize">{d.type}</td>
              <td className="px-4 py-2.5 font-mono text-[var(--ic-muted)]">{d.ip}</td>
              <td className="px-4 py-2.5 text-[var(--ic-muted)]">{d.os}</td>
              <td className="px-4 py-2.5"><span className={`text-xs font-medium ${d.status === 'online' ? 'text-emerald-400' : d.status === 'degraded' ? 'text-amber-400' : 'text-red-400'}`}>{d.status}</span></td>
              <td className="px-4 py-2.5">
                {d.isProbe
                  ? <span title="Machine hôte de l'agent INFRAvx : découverte automatique et scans SNMP lancés depuis cette machine, supervisée comme tout autre device."
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30 text-[11px] font-bold"><Radar className="w-3 h-3" /> PROBE</span>
                  : <span className="text-xs text-[var(--ic-muted)]">supervisé{devices.find(x => x.isProbe && x.orgId === d.orgId) ? ' via probe' : ''}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-3 text-[11px] text-[var(--ic-muted)] border-t border-[var(--ic-border)]">💡 La <b>probe</b> est la machine sur laquelle l'agent collecteur est installé : c'est depuis elle que partent l'auto-discovery et les scans. Elle est monitorée (CPU, heartbeat agent, uptime) exactement comme les autres devices — si elle tombe, les devices découverts deviennent « unreachable ».</p>
    </div>
  );
}

function MembersTab({ orgId }: { orgId: string }) {
  const id = Number(orgId);
  const techs = demoTechnicians.filter(t => t.orgId === id);
  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4 space-y-2">
      {techs.map(t => (
        <div key={t.email} className="flex items-center justify-between py-2 border-b border-[var(--ic-border)] last:border-0">
          <div><div className="text-sm text-[var(--ic-heading)] font-medium">{t.name}</div><div className="text-xs text-[var(--ic-muted)] font-mono">{t.email}</div></div>
          <div className="text-right"><span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300">{t.role}</span><div className="text-[11px] text-[var(--ic-muted)] mt-1">{t.skills}</div></div>
        </div>
      ))}
      {techs.length === 0 && <p className="text-sm text-[var(--ic-muted)]">Aucun membre — utilisez « Invite Member » depuis le Tenant Manager.</p>}
    </div>
  );
}

function PlaceholderTab({ label }: { label: string }) {
  return <div className="p-6 rounded-xl bg-[var(--ic-surface)] border border-[var(--ic-border)] text-sm text-[var(--ic-muted)]">{label}</div>;
}

/* ---------- Services + Grant Access (override plan) ---------- */
function ServicesTab({ orgId }: { orgId: string }) {
  const [grants, setGrants] = useState<Record<string, ServiceGrantOut>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  useEffect(() => { tenantManagerApi.grants(orgId).then(setGrants).catch(() => {}); }, [orgId]);

  const toggle = async (serviceId: string, nextEnabled: boolean) => {
    setBusyId(serviceId);
    try {
      const g = await tenantManagerApi.setGrant(orgId, { service_id: serviceId, enabled: nextEnabled, override_plan: true });
      setGrants(prev => ({ ...prev, [serviceId]: g }));
    } finally { setBusyId(null); }
  };

  return (
    <div className="space-y-3">
      <div className="bg-cyan-500/5 border border-[var(--ic-border)] rounded-lg p-3 text-xs text-cyan-300">
        <b>Grant Access</b> active ou désactive un service pour ce client en dépassant temporairement les limites de son plan (override audité — chaque changement est tracé dans l'Audit Log sous <span className="font-mono">entitlement.updated</span>).
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {serviceCatalog.map(s => {
          const g = grants[s.id];
          const enabled = g ? g.enabled : s.availableTiers.length > 0; // default from plan unless overridden
          return (
            <div key={s.id} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-2xl">{s.icon}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--ic-heading)] truncate">{s.name}</div>
                  <div className="text-[11px] text-[var(--ic-muted)]">
                    {g ? `Override plateforme — ${g.granted_by}` : 'Conforme au plan'}
                    {g && <span className="ml-1 text-amber-300">(override)</span>}
                  </div>
                </div>
              </div>
              <button onClick={() => toggle(s.id, !enabled)} disabled={busyId === s.id}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  enabled ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-red-500/10 hover:text-red-400'
                          : 'bg-cyan-500/10 text-cyan-400 border-[var(--ic-border)] hover:bg-cyan-500/20'}`}>
                {busyId === s.id ? '…' : enabled ? 'Désactiver' : 'Grant Access'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Rules Engine CRUD ---------- */
const METRIC_SUGG: Record<string, { label: string; hint: string }> = {
  cpu: { label: 'CPU (%)', hint: 'ex : 85 — alerte classique à 85 % pendant 5 min' },
  memory: { label: 'Mémoire (%)', hint: 'ex : 90 — les serveurs DB montent souvent à 88 %' },
  disk: { label: 'Disque (%)', hint: 'ex : 90 — seuil recommandé avant saturation logs/backup' },
  network: { label: 'Réseau (% bande passante)', hint: 'ex : 80 sur un lien WAN 1 Gbps' },
  status: { label: 'Statut device', hint: 'ex : offline — valeur littérale, pas de nombre' },
  alert: { label: 'Alerte corrélée', hint: 'ex : severity=critical ou source=wazuh' },
  event: { label: 'Événement système', hint: 'ex : backup_failed, auth_failures, cert_expiring' },
};
const ACTION_LABEL: Record<string, string> = {
  create_ticket: 'Créer un ticket automatiquement', notify: 'Notifier uniquement (email/SMS/webhook)',
  suppress_alert: 'Supprimer / masquer l’alerte', none: 'Informatif (aucune action)',
};

function RulesTab({ orgId }: { orgId: string }) {
  const [rules, setRules] = useState<MonitoringRuleOut[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: '', scope: 'client', target_asset_id: '', trigger_metric: 'cpu', operator: '>', threshold: '85', duration_min: 5, action: 'notify', ticket_priority: 'P3', notify_channels: 'email' });
  const load = () => tenantManagerApi.listRules(orgId).then(setRules).catch(() => {});
  useEffect(() => { load(); }, [orgId]);

  const save = async () => {
    const r = await tenantManagerApi.createRule(orgId, {
      name: form.name, scope: form.scope as any, target_asset_id: form.target_asset_id || null,
      trigger_metric: form.trigger_metric, operator: form.operator, threshold: form.threshold,
      duration_min: Number(form.duration_min), action: form.action as any, ticket_priority: form.ticket_priority,
      notify_channels: form.notify_channels.split(',').map(x => x.trim()).filter(Boolean),
    });
    setRules(prev => [r, ...prev]); setFormOpen(false); setForm({ ...form, name: '', threshold: '85' });
  };
  const remove = async (rid: string) => { await tenantManagerApi.deleteRule(orgId, rid); setRules(prev => prev.filter(r => r.id !== rid)); };
  const toggleEnabled = async (r: MonitoringRuleOut) => {
    const upd = await tenantManagerApi.patchRule(orgId, r.id, { enabled: !r.enabled });
    setRules(prev => prev.map(x => x.id === r.id ? upd : x));
  };

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)]';
  const devices = demoDevices.filter(d => d.orgId === Number(orgId));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--ic-muted)]">Règles de supervision : si <i>métrique</i> <i>opérateur</i> <i>seuil</i> pendant N minutes → action (ticket auto, notification, suppression ou informatif).</p>
        <button onClick={() => setFormOpen(o => !o)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium"><PlusCircle className="w-4 h-4" /> Nouvelle règle</button>
      </div>

      {formOpen && (
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4 grid md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Nom de la règle *</label>
            <input className={inputCls} placeholder="ex : CPU serveur critique > 85% → ticket P2" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Portée (scope)</label>
            <select className={inputCls} value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })}>
              <option value="asset">Un asset précis</option><option value="client">Tout le client</option><option value="platform">Plateforme (tous clients)</option>
            </select>
          </div>
          {form.scope === 'asset' && (
            <div>
              <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Asset cible</label>
              <select className={inputCls} value={form.target_asset_id} onChange={e => setForm({ ...form, target_asset_id: e.target.value })}>
                <option value="">— choisir —</option>
                {devices.map(d => <option key={d.id} value={d.id}>{d.hostname} {d.isProbe ? '(PROBE)' : ''}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Métrique déclencheuse</label>
            <select className={inputCls} value={form.trigger_metric} onChange={e => setForm({ ...form, trigger_metric: e.target.value })}>
              {Object.entries(METRIC_SUGG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <p className="text-[11px] text-cyan-300 mt-1">💡 {METRIC_SUGG[form.trigger_metric].hint}</p>
          </div>
          <div className="flex gap-2">
            <div className="w-24">
              <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Op.</label>
              <select className={inputCls} value={form.operator} onChange={e => setForm({ ...form, operator: e.target.value })}>
                {['>', '<', '>=', '<=', '==', '!='].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Seuil *</label>
              <input className={inputCls} placeholder={METRIC_SUGG[form.trigger_metric].hint.replace('ex : ', '')} value={form.threshold} onChange={e => setForm({ ...form, threshold: e.target.value })} />
            </div>
            <div className="w-24">
              <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Min.</label>
              <input type="number" className={inputCls} value={form.duration_min} onChange={e => setForm({ ...form, duration_min: Number(e.target.value) })} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Action</label>
            <select className={inputCls} value={form.action} onChange={e => setForm({ ...form, action: e.target.value })}>
              {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {form.action === 'create_ticket' && (
            <div>
              <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Priorité ticket</label>
              <select className={inputCls} value={form.ticket_priority} onChange={e => setForm({ ...form, ticket_priority: e.target.value })}>
                {['P1', 'P2', 'P3', 'P4'].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          )}
          {(form.action === 'notify' || form.action === 'create_ticket') && (
            <div>
              <label className="block text-xs font-semibold text-[var(--ic-muted)] uppercase mb-1">Canaux (séparés par virgule)</label>
              <input className={inputCls} placeholder="email, sms, webhook" value={form.notify_channels} onChange={e => setForm({ ...form, notify_channels: e.target.value })} />
            </div>
          )}
          <div className="md:col-span-2 flex justify-end gap-2">
            <button onClick={() => setFormOpen(false)} className="px-4 py-2 rounded-lg text-sm text-[var(--ic-muted)] hover:bg-[var(--ic-surface-2)]">Annuler</button>
            <button onClick={save} disabled={!form.name.trim() || !form.threshold.trim()} className="px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50">Enregistrer la règle</button>
          </div>
        </div>
      )}

      {rules.map(r => (
        <div key={r.id} className={`bg-[var(--ic-surface)] border rounded-xl p-4 flex items-center justify-between gap-3 ${r.enabled ? 'border-[var(--ic-border)]' : 'border-[var(--ic-border)] opacity-60'}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-[var(--ic-heading)]">{r.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 uppercase">{r.scope}</span>
              {r.target_asset_id && <span className="text-[11px] font-mono text-[var(--ic-muted)]">→ {devices.find(d => d.id === r.target_asset_id)?.hostname ?? r.target_asset_id}</span>}
            </div>
            <p className="text-xs text-[var(--ic-muted)] mt-1">
              si <b className="text-[var(--ic-heading)]">{METRIC_SUGG[r.trigger_metric]?.label ?? r.trigger_metric}</b> {r.operator} <b className="text-[var(--ic-heading)]">{r.threshold}</b> pendant {r.duration_min} min
              → <span className="text-cyan-300">{ACTION_LABEL[r.action] ?? r.action}{r.action === 'create_ticket' ? ` (${r.ticket_priority})` : ''}</span>
              {' · '}{r.notify_channels.join(', ')} · créé par {r.created_by}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => toggleEnabled(r)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${r.enabled ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-[var(--ic-surface-2)] text-[var(--ic-muted)] border-[var(--ic-border)]'}`}>{r.enabled ? 'Active' : 'Inactive'}</button>
            <button onClick={() => remove(r.id)} className="p-2 rounded-lg text-red-400 hover:bg-red-500/10"><Trash2 className="w-4 h-4" /></button>
          </div>
        </div>
      ))}
      {rules.length === 0 && <div className="p-6 text-center text-sm text-[var(--ic-muted)] bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl">Aucune règle pour ce client — cliquez sur « Nouvelle règle ».</div>}
    </div>
  );
}
