// ---------------------------------------------------------------------------
// Partner Portal (MSP) — pages ONLY accessible with role partner_admin.
// A partner sees THEIR OWN data: their end-clients, their licensing usage,
// their white-label branding, their team training, and their Value & Loyalty
// scorecard (the partner program — a different system from client loyalty).
// They NEVER see Infracentra's direct clients nor other partners (enforced
// by the API layer, mirrored in demoMode.ts with 403s).
// White-label: header uses the partner's brand name + primary color.
// Pricing: V2 engine only — src/data/pricingConfig.ts + pricingEngine.quote().
// The full wholesale partner UI (tier progress, margin simulator, deal
// registration) is Phase 3; this page shows the pack catalogue + estimator.
// ---------------------------------------------------------------------------
import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { partnersApi } from '../../services/partnersApi';
import type { Partner, PartnerEndClient } from '../../data/partnerWorld';
import { partnerValueProfile, partnerProgramTiers, type PartnerValueProfile } from '../../data/partnerValue';
import { PRICING_CONFIG_V2, PACK_SERVICES, SERVICE_LABELS_FR, fmtMad, type PackId } from '../../data/pricingConfig';
import { quote, billableUnits, partnerTierFor, type QuoteInputs } from '../../services/pricingEngine';
import {
  Building2, Server, Users, Euro, Gauge, Globe, CheckCircle2, Clock, XCircle,
  Loader2, Plus, Trash2, Palette, Upload, RefreshCw, GraduationCap, Award,
  TrendingUp, ShieldCheck, Percent, Headphones, Star, BarChart3, AlertTriangle, CalendarDays, KeyRound, Mail,
} from 'lucide-react';

const fmtEur = (n: number) => `${n.toLocaleString('fr-FR')} €`;

function Card({ title, icon: Icon, children, className = '' }: any) {
  return (
    <div className={`bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-5 ${className}`}>
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--ic-muted)] mb-4">
        <Icon className="w-4 h-4" /> {title}
      </h3>
      {children}
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-4">
      <div className="text-[11px] text-[var(--ic-muted)] uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1" style={{ color: accent }}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--ic-muted)] mt-1">{sub}</div>}
    </div>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-2 rounded-full bg-[var(--ic-surface)] overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  );
}

// Small inline SVG line chart (no external lib) for MRR history.
function MiniLine({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const mx = Math.max(...data), mn = Math.min(...data), r = mx - mn || 1;
  const pts = data.map((v, i) => `${(i * 100) / (data.length - 1)},${(34 - ((v - mn) / r) * 26).toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="w-full h-9">
      <polyline fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" points={pts} />
    </svg>
  );
}

function usePartnerData() {
  const { user } = useAuth();
  const pid = String(user?.orgId ?? '');
  const [partner, setPartner] = useState<Partner | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setLoading(true); setError(null);
    try { setPartner(await partnersApi.get(pid)); }
    catch (e: any) { setError(e?.message ?? 'Erreur de chargement'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [pid]);
  return { partner, loading, error, reload: load, pid };
}

const StatusBadge = ({ s }: { s: string }) => {
  const map: Record<string, string> = { active: 'text-emerald-400', onboarding: 'text-amber-400', suspended: 'text-rose-400' };
  return <span className={`inline-flex items-center gap-1 text-xs font-semibold ${map[s] ?? 'text-[var(--ic-muted)]'}`}>{s === 'active' ? <CheckCircle2 className="w-3.5 h-3.5" /> : s === 'onboarding' ? <Clock className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />} {s}</span>;
};

const Loader = () => <div className="flex items-center gap-3 text-[var(--ic-muted)] p-8"><Loader2 className="w-5 h-5 animate-spin" /> Chargement du portail partenaire…</div>;
const ErrorBox = ({ msg, onRetry }: { msg: string; onRetry: () => void }) => (
  <div className="p-8"><div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl p-4 flex items-center justify-between">{msg || 'Erreur'}
    <button onClick={onRetry} className="inline-flex items-center gap-1 text-sm border border-rose-500/40 rounded-lg px-3 py-1 hover:bg-rose-500/20 cursor-pointer"><RefreshCw className="w-3.5 h-3.5" /> Réessayer</button></div></div>
);

// ===========================================================================
// 1. PARTNER DASHBOARD — overview of THEIR book only
// ===========================================================================
export function PartnerDashboardPage() {
  const { partner, loading, error, reload } = usePartnerData();
  const value = useMemo(() => (partner ? partnerValueProfile(partner) : null), [partner]);
  if (loading) return <Loader />;
  if (error || !partner) return <ErrorBox msg={error ?? 'Partner introuvable'} onRetry={reload} />;

  const lic = partner.license;
  const retailMrr = partner.end_clients.reduce((a, c) => a + c.monthly_mrr_eur, 0);
  const margin = retailMrr ? Math.round(((retailMrr - lic.price_month_eur) / retailMrr) * 100) : 0;
  const onboarding = partner.end_clients.filter(c => c.status === 'onboarding').length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: partner.branding.primary_color }}>Tableau de bord {partner.branding.brand_name}</h1>
          <p className="text-sm text-[var(--ic-muted)]">{partner.company} · Tier {partner.tier} · Partenaire depuis {new Date(partner.signed_on).toLocaleDateString('fr-FR')}</p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"><ShieldCheck className="w-3.5 h-3.5" /> Portail white-label · {partner.branding.custom_domain}</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Mes clients" value={String(partner.end_clients.length)} sub={`${lic.client_seats} sièges licence`} accent="#22d3ee" />
        <Kpi label="Périphériques gérés" value={String(lic.devices_used)} sub={`alloués : ${lic.device_allowance}`} accent="#a78bfa" />
        <Kpi label="CA facturé à mes clients" value={fmtEur(retailMrr)} sub="/ mois" accent="#34d399" />
        <Kpi label="Ma marge" value={`${margin} %`} sub={`wholesale ${fmtEur(lic.price_month_eur)}/mois`} accent="#fbbf24" />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Card title="Santé du portefeuille" icon={BarChart3}>
          {value && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm"><span>Score partenaire</span><b style={{ color: partner.branding.primary_color }}>{value.score}/100</b></div>
              <ProgressBar pct={value.score} color={partner.branding.primary_color} />
              <div className="grid grid-cols-3 gap-3 pt-2 text-center">
                <div><div className="text-lg font-bold text-emerald-400">{value.nrr_pct}%</div><div className="text-[11px] text-[var(--ic-muted)]">NRR portefeuille</div></div>
                <div><div className="text-lg font-bold text-cyan-400">{value.csat}</div><div className="text-[11px] text-[var(--ic-muted)]">CSAT /5</div></div>
                <div><div className="text-lg font-bold text-amber-400">{value.churn_rate_pct}%</div><div className="text-[11px] text-[var(--ic-muted)]">Churn clients</div></div>
              </div>
              <div className="pt-2"><MiniLine data={value.history.map(h => h.mrr_eur)} color={partner.branding.primary_color} /><div className="text-[11px] text-[var(--ic-muted)] mt-1">Évolution du CA mensuel (8 derniers mois)</div></div>
            </div>
          )}
        </Card>
        <Card title="À traiter" icon={AlertTriangle}>
          <ul className="space-y-3 text-sm">
            {onboarding > 0 && <li className="flex gap-2"><Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" /> {onboarding} client(s) en cours d’onboarding — finalisez l’auto-découverte SNMP.</li>}
            {partner.branding.dns_status !== 'verified' && <li className="flex gap-2"><Globe className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" /> Domaine {partner.branding.custom_domain} non vérifié — voir « Branding & Domain ».</li>}
            {partner.training.pending.length > 0 && <li className="flex gap-2"><GraduationCap className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" /> Formations en attente : {partner.training.pending.join(', ')}.</li>}
            {value && value.next_tier && <li className="flex gap-2"><Star className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" /> Plus que <b>{value.points_to_next_tier} pts</b> pour atteindre le tier {value.next_tier}.</li>}
            <li className="flex gap-2"><Headphones className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /> SLA Infracentra envers vous : {partner.support_sla}.</li>
          </ul>
        </Card>
      </div>

      <Card title="Mes clients — vue opérationnelle" icon={Building2}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--ic-muted)]">
              <th className="pb-2 pr-4">Client</th><th className="pb-2 pr-4">Ville</th><th className="pb-2 pr-4">Plan</th>
              <th className="pb-2 pr-4">Devices</th><th className="pb-2 pr-4">Users</th><th className="pb-2 pr-4">MRR</th><th className="pb-2">Statut</th>
            </tr></thead>
            <tbody>
              {partner.end_clients.map(c => (
                <tr key={c.id} className="border-t border-[var(--ic-border)]">
                  <td className="py-2.5 pr-4 font-medium">{c.name}<div className="text-[11px] text-[var(--ic-muted)]">{c.industry}</div></td>
                  <td className="py-2.5 pr-4 text-[var(--ic-muted)]">{c.city}</td>
                  <td className="py-2.5 pr-4 text-[var(--ic-muted)]">{c.plan}</td>
                  <td className="py-2.5 pr-4">{c.devices}</td>
                  <td className="py-2.5 pr-4">{c.users}</td>
                  <td className="py-2.5 pr-4 text-emerald-400">{fmtEur(c.monthly_mrr_eur)}</td>
                  <td className="py-2.5"><StatusBadge s={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-[var(--ic-muted)] mt-3">Les données temps réel (alertes, tickets, devices) de chaque client sont visibles depuis les sections Alerts / Tickets / Monitored Devices — filtrées sur votre portefeuille uniquement.</p>
      </Card>
    </div>
  );
}

// ===========================================================================
// 2. MY CLIENTS — CRUD end-client tenants under the partner license
// ===========================================================================
export function PartnerClientsPage() {
  const { partner, loading, error, reload } = usePartnerData();
  const [form, setForm] = useState({ name: '', industry: '', city: 'Casablanca', plan: 'SME', devices: '', users: '', monthly_mrr_eur: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (loading) return <Loader />;
  if (error || !partner) return <ErrorBox msg={error ?? ''} onRetry={reload} />;
  const lic = partner.license;
  const seatsLeft = lic.client_seats - lic.client_seats_used;

  const addClient = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await partnersApi.addClient(partner.id, { ...form, devices: Number(form.devices), users: Number(form.users), monthly_mrr_eur: Number(form.monthly_mrr_eur) });
      setForm({ name: '', industry: '', city: 'Casablanca', plan: 'SME', devices: '', users: '', monthly_mrr_eur: '' });
      await reload();
    } catch (err: any) { setMsg(err?.message ?? 'Erreur'); }
    finally { setBusy(false); }
  };
  const remove = async (c: PartnerEndClient) => {
    if (!window.confirm(`Retirer le client « ${c.name} » ? Son tenant sera désactivé.`)) return;
    await partnersApi.removeClient(partner.id, c.id); reload();
  };

  const inp = 'bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-cyan-500';
  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div><h1 className="text-xl font-bold">Mes clients</h1>
          <p className="text-sm text-[var(--ic-muted)]">{partner.end_clients.length} / {lic.client_seats} sièges utilisés · {seatsLeft} disponible(s)</p></div>
        <div className="w-48"><ProgressBar pct={(lic.client_seats_used / lic.client_seats) * 100} color={partner.branding.primary_color} /><div className="text-[11px] text-[var(--ic-muted)] mt-1 text-right">{lic.client_seats_used}/{lic.client_seats} sièges</div></div>
      </header>

      <Card title="Ajouter un client final (provisionne son tenant sous VOTRE marque)" icon={Plus}>
        <form onSubmit={addClient} className="grid md:grid-cols-3 gap-3">
          <input className={inp} placeholder="Nom du client *" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input className={inp} placeholder="Secteur (Retail, Santé…)" value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} />
          <input className={inp} placeholder="Ville" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
          <select className={inp} value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value })}>
            <option>SME</option><option>Pro</option><option>Enterprise</option>
          </select>
          <input className={inp} type="number" min="1" placeholder="Périphériques estimés *" required value={form.devices} onChange={e => setForm({ ...form, devices: e.target.value })} />
          <input className={inp} type="number" min="1" placeholder="Utilisateurs *" required value={form.users} onChange={e => setForm({ ...form, users: e.target.value })} />
          <input className={inp} type="number" min="0" placeholder="Prix mensuel facturé (€) *" required value={form.monthly_mrr_eur} onChange={e => setForm({ ...form, monthly_mrr_eur: e.target.value })} />
          <button disabled={busy || seatsLeft <= 0} className={`${inp} !w-auto justify-self-start cursor-pointer font-semibold text-slate-900 disabled:opacity-40`} style={{ background: partner.branding.primary_color }}>
            {busy ? 'Création…' : seatsLeft <= 0 ? 'Licence pleine' : 'Créer le tenant client'}
          </button>
        </form>
        {msg && <p className="text-rose-400 text-sm mt-3">{msg}</p>}
        <p className="text-[11px] text-[var(--ic-muted)] mt-3">Le client reçoit une invitation sur votre domaine white-label ({partner.branding.email_sender || partner.branding.custom_domain}) — aucune mention d’Infracentra si le full white-label est activé.</p>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        {partner.end_clients.map(c => (
          <div key={c.id} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-4 flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">{c.name} <StatusBadge s={c.status} /></div>
              <div className="text-xs text-[var(--ic-muted)] mt-1">{c.industry} · {c.city} · depuis {new Date(c.since).toLocaleDateString('fr-FR')}</div>
              <div className="text-xs text-[var(--ic-muted)] mt-2 flex gap-4">
                <span className="flex items-center gap-1"><Server className="w-3.5 h-3.5" />{c.devices} dev</span>
                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{c.users} users</span>
                <span className="flex items-center gap-1 text-emerald-400"><Euro className="w-3.5 h-3.5" />{fmtEur(c.monthly_mrr_eur)}/mois</span>
              </div>
            </div>
            <button onClick={() => remove(c)} className="text-[var(--ic-muted)] hover:text-rose-400 cursor-pointer" title="Retirer"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// 3. LICENSING & USAGE — what they bought from us + consumption
// ===========================================================================
export function PartnerLicensingPage() {
  const { partner, loading, error, reload } = usePartnerData();
  if (loading) return <Loader />;
  if (error || !partner) return <ErrorBox msg={error ?? ''} onRetry={reload} />;
  const lic = partner.license;
  const svcCount = lic.services_included.includes('all') ? 16 : lic.services_included.length + (lic.ticketing ? 1 : 0);
  const deviceRatio = lic.devices_used / lic.device_allowance;

  return (
    <div className="space-y-5">
      <header><h1 className="text-xl font-bold">Licensing & Usage</h1><p className="text-sm text-[var(--ic-muted)]">Contrat de revente Infracentra — renouvellement le {new Date(lic.renews_on).toLocaleDateString('fr-FR')}</p></header>
      <div className="grid md:grid-cols-3 gap-4">
        <Card title="Plan licencié" icon={ShieldCheck}>
          <div className="text-3xl font-bold" style={{ color: partner.branding.primary_color }}>{lic.plan}</div>
          <ul className="text-sm text-[var(--ic-muted)] mt-3 space-y-1">
            <li>{lic.client_seats} sièges clients finaux</li>
            <li>{lic.device_allowance} périphériques supervisés</li>
            <li>{svcCount} services inclus {lic.ticketing ? '+ Advanced Ticketing' : ''}</li>
            <li>Revente dès {fmtEur(lic.resale_price_from_eur)}/client/mois</li>
          </ul>
        </Card>
        <Card title="Consommation" icon={Gauge}>
          <div className="space-y-4 text-sm">
            <div><div className="flex justify-between mb-1"><span>Sièges clients</span><span>{lic.client_seats_used}/{lic.client_seats}</span></div><ProgressBar pct={(lic.client_seats_used / lic.client_seats) * 100} color={partner.branding.primary_color} /></div>
            <div><div className="flex justify-between mb-1"><span>Périphériques</span><span>{lic.devices_used}/{lic.device_allowance}</span></div><ProgressBar pct={deviceRatio * 100} color={deviceRatio > 0.85 ? '#fb7185' : '#34d399'} /></div>
            {deviceRatio > 0.85 && <p className="text-amber-400 text-xs">Approche de la limite — contactez votre account manager pour augmenter l’allocation avant facturation hors quota.</p>}
          </div>
        </Card>
        <Card title="Économie" icon={Percent}>
          <div className="text-sm space-y-2">
            <div className="flex justify-between"><span className="text-[var(--ic-muted)]">Wholesale (à Infracentra)</span><b>{fmtEur(lic.price_month_eur)}/mois</b></div>
            <div className="flex justify-between"><span className="text-[var(--ic-muted)]">Retail facturé (mes clients)</span><b className="text-emerald-400">{fmtEur(partner.end_clients.reduce((a, c) => a + c.monthly_mrr_eur, 0))}/mois</b></div>
            <div className="flex justify-between border-t border-[var(--ic-border)] pt-2"><span className="text-[var(--ic-muted)]">Marge brute</span><b style={{ color: partner.branding.primary_color }}>{fmtEur(Math.max(0, partner.end_clients.reduce((a, c) => a + c.monthly_mrr_eur, 0) - lic.price_month_eur))}/mois</b></div>
            <p className="text-[11px] text-[var(--ic-muted)] pt-2">Maintenance plateforme, mises à jour et formation continue de vos équipes sont incluses dans le wholesale.</p>
          </div>
        </Card>
      </div>
      <Card title="Services inclus dans votre licence" icon={Server}>
        <div className="flex flex-wrap gap-2">
          {(lic.services_included.includes('all')
            ? ['Threat Intel', 'Compliance', 'Incident Response', 'Analytics', 'SOAR', 'Vuln. Scanning', 'Patch Mgmt', 'Backup & DR', 'Endpoint', 'Email Security', 'Cloud Security', 'Network', 'DNS Filtering', 'Firewall', 'VPN', 'SD-WAN']
            : lic.services_included).map((s: string) => (
            <span key={s} className="px-3 py-1 rounded-full text-xs border border-[var(--ic-border)] bg-[var(--ic-surface)] capitalize">{s.replace(/-/g, ' ')}</span>
          ))}
          {lic.ticketing && <span className="px-3 py-1 rounded-full text-xs border font-semibold" style={{ borderColor: partner.branding.primary_color, color: partner.branding.primary_color }}>Advanced Ticketing</span>}
        </div>
      </Card>
      <BundleTiersSection managedUnits={partner.end_clients.reduce((a, c) => a + (c.devices ?? 0), 0)} />
      <InvoiceCalculatorSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pricing V2 — 3 pack cards + real-time invoice estimator (direct list price).
// Prices come EXCLUSIVELY from PRICING_CONFIG_V2 and quote() (mirror of
// backend/app/services/pricing_engine.py). The wholesale partner experience
// (tier discount table, margin simulator, deal registration) is Phase 3.
// ---------------------------------------------------------------------------
const PACK_IDS: PackId[] = ['starter', 'pro', 'souverain'];
const PACK_BLURB: Record<PackId, string> = {
  starter: 'Petites équipes IT. Supervision complète du parc, sauvegarde et conformité.',
  pro: 'Équipes SOC structurées. Toute la plateforme + services offerts (DNS, analytique, threat intel, ticketing).',
  souverain: 'MSP / grandes infrastructures. SOAR, cloud, SD-WAN et astreinte 24/7 incluse.',
};

/** Map a physical endpoint count to V2 asset classes (~80 % heavy / 20 % light),
 *  identical to demoMode.ts so estimates match the tenant invoices. */
function assetsFromEndpoints(n: number): QuoteInputs['assets'] {
  const heavy = Math.round(n * 0.8);
  return [{ class: 'workstation', qty: heavy }, { class: 'mailbox', qty: Math.max(0, n - heavy) }];
}

function BundleTiersSection({ managedUnits }: { managedUnits: number }) {
  const tier = partnerTierFor(PRICING_CONFIG_V2, managedUnits);
  return (
    <div>
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--ic-muted)] mb-3">
        <ShieldCheck className="w-4 h-4" /> Packs Infracentra — facturation par unité-service (moteur V2 v{PRICING_CONFIG_V2.version})
      </h3>
      <p className="text-[11px] text-[var(--ic-muted)] mb-3">
        Votre palier partenaire actuel : <b className="text-[var(--ic-heading)]">{tier.id}</b> — remise de gros
        {Math.round(tier.discount * 100)} % sur les lignes par unité (détail wholesale : section Licensing, Phase 3).
        Les prix ci-dessous sont les prix catalogue publics, hors TVA.
      </p>
      <div className="grid md:grid-cols-3 gap-4">
        {PACK_IDS.map((p) => {
          const d = PRICING_CONFIG_V2.packs[p];
          const range = d.maxUnits === null ? `dès ${d.minUnits} unités` : `${d.minUnits} à ${d.maxUnits} unités`;
          return (
            <div key={p} className={`bg-[var(--ic-surface)] border rounded-2xl p-5 ${p === 'souverain' ? 'border-violet-500/60' : 'border-[var(--ic-border)]'}`}>
              <div className="text-sm font-bold text-[var(--ic-heading)] uppercase">{p === 'souverain' ? 'Souverain (Enterprise)' : p}</div>
              <div className="mt-2 text-2xl font-extrabold" style={{ color: p === 'souverain' ? '#a78bfa' : '#22d3ee' }}>
                {fmtMad(d.price)}
                <span className="text-xs font-normal text-[var(--ic-muted)]"> /unité-service/mois HT</span>
              </div>
              <div className="text-[11px] text-emerald-400 mt-1">Éligibilité : {range}</div>
              <ul className="text-sm text-[var(--ic-muted)] mt-3 space-y-1">
                <li>{PACK_SERVICES[p].length} services inclus</li>
                <li>SIEM : {d.siemQuota.min > 0 ? `${d.siemQuota.min} Go/jour inclus (+${d.siemQuota.perUnit} Go/unité)` : 'non inclus (options payantes)'}</li>
                <li>Rétention : {d.retentionDays} jours</li>
                <li>Sauvegarde : {d.backupQuotaGbPerUnit} Go/unité</li>
                <li>Support : {d.support}</li>
                <li>Mise en service : {fmtMad(d.onboarding)}</li>
              </ul>
              <p className="text-[11px] text-[var(--ic-muted)] mt-3">{PACK_BLURB[p]}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InvoiceCalculatorSection() {
  const [pack, setPack] = useState<PackId>('pro');
  const [contractMonths, setContractMonths] = useState<0 | 12 | 24 | 36>(0);
  const [endpoints, setEndpoints] = useState(100);
  const [siem, setSiem] = useState(20);
  const def = PRICING_CONFIG_V2.packs[pack];
  const assets = useMemo(() => assetsFromEndpoints(endpoints), [endpoints]);
  const units = useMemo(() => billableUnits(PRICING_CONFIG_V2, assets), [assets]);
  const q = useMemo(() => quote({
    mode: 'pack', pack, assets,
    siemGbDay: siem || undefined,
    retentionDays: def.retentionDays,
    contractMonths,
  }), [pack, assets, siem, def.retentionDays, contractMonths]);
  const num = 'bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-cyan-500';

  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-5">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--ic-muted)] mb-4">
        <Percent className="w-4 h-4" /> Estimateur de facture (prix catalogue, moteur V2)
      </h3>
      <div className="grid md:grid-cols-4 gap-3 text-sm">
        <label className="block"><span className="text-xs text-[var(--ic-muted)]">Pack</span>
          <select className={num} value={pack} onChange={(e) => setPack(e.target.value as PackId)}>
            {PACK_IDS.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
          </select></label>
        <label className="block"><span className="text-xs text-[var(--ic-muted)]">Durée du contrat</span>
          <select className={num} value={contractMonths} onChange={(e) => setContractMonths(Number(e.target.value) as 0 | 12 | 24 | 36)}>
            <option value={0}>Sans engagement</option><option value={12}>12 mois −8 %</option>
            <option value={24}>24 mois −12 %</option><option value={36}>36 mois −15 %</option>
          </select></label>
        <label className="block"><span className="text-xs text-[var(--ic-muted)]">Actifs supervisés</span>
          <input type="number" min={1} className={num} value={endpoints} onChange={(e) => setEndpoints(Math.max(0, Number(e.target.value)))} /></label>
        <label className="block"><span className="text-xs text-[var(--ic-muted)]">SIEM Go/jour</span>
          <input type="number" min={0} className={num} value={siem} onChange={(e) => setSiem(Math.max(0, Number(e.target.value)))} /></label>
      </div>
      {!q.eligible ? (
        <p className="text-sm text-amber-400 mt-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {q.reason}
        </p>
      ) : (
        <>
          <table className="w-full text-sm mt-4">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-[var(--ic-muted)]">
              <th className="py-1">Ligne</th><th>Qté</th><th>P.U.</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {q.lines.filter(l => l.kind !== 'vat').map((ln, i) => (
                <tr key={i} className="border-t border-[var(--ic-border)]">
                  <td className="py-1.5">{ln.label_fr}</td>
                  <td>{ln.qty !== undefined ? ln.qty : '—'}</td>
                  <td>{ln.unit_mad !== undefined ? fmtMad(ln.unit_mad) : '—'}</td>
                  <td className="text-right">{fmtMad(ln.amount_mad)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between items-center border-t border-[var(--ic-border)] mt-2 pt-3">
            <span className="text-xs text-[var(--ic-muted)]">
              {units.toFixed(1)} unité(s)-service facturée(s) · TVA {Math.round(PRICING_CONFIG_V2.vat * 100)} % : {fmtMad(q.totals.vat_mad)}
            </span>
            <span className="text-xl font-extrabold" style={{ color: '#22d3ee' }}>{fmtMad(q.totals.monthly_excl_vat_mad)} /mois HT</span>
          </div>
        </>
      )}
      <p className="text-[11px] text-[var(--ic-muted)] mt-2">Prix catalogue publics hors TVA — la remise wholesale de votre palier est appliquée côté Licensing (Phase 3). Devis calculé par le même moteur que le backend (version {q.config_version}).</p>
    </div>
  );
}

// ===========================================================================
// 4. BRANDING & DOMAIN — white-label control center
// ===========================================================================
export function PartnerBrandingPage() {
  const { partner, loading, error, reload } = usePartnerData();
  const [brand, setBrand] = useState(''); const [color, setColor] = useState('#0ea5e9');
  const [domain, setDomain] = useState(''); const [sender, setSender] = useState('');
  const [hideVendor, setHideVendor] = useState(false); const [logo, setLogo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false); const [done, setDone] = useState<string | null>(null);

  useEffect(() => { if (partner) { const b = partner.branding; setBrand(b.brand_name); setColor(b.primary_color); setDomain(b.custom_domain); setSender(b.email_sender); setHideVendor(b.hide_infracentra); setLogo(b.logo_data_url); } }, [partner]);
  if (loading) return <Loader />;
  if (error || !partner) return <ErrorBox msg={error ?? ''} onRetry={reload} />;

  const save = async () => {
    setSaving(true);
    await partnersApi.updateBranding(partner.id, { brand_name: brand, primary_color: color, custom_domain: domain, email_sender: sender, hide_infracentra: hideVendor, logo_data_url: logo });
    setSaving(false); setDone('Branding enregistré.'); setTimeout(() => setDone(null), 3000); reload();
  };
  const verify = async () => { await partnersApi.verifyDomain(partner.id); reload(); };
  const onLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const rd = new FileReader(); rd.onload = () => setLogo(String(rd.result)); rd.readAsDataURL(f);
  };
  const inp = 'bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-cyan-500';

  return (
    <div className="space-y-5">
      <header><h1 className="text-xl font-bold">Branding & Domain (White-label)</h1><p className="text-sm text-[var(--ic-muted)]">Votre marque, votre domaine — Infracentra reste invisible pour vos clients.</p></header>
      <div className="grid md:grid-cols-2 gap-5">
        <Card title="Identité de marque" icon={Palette}>
          <div className="space-y-3">
            <label className="text-xs text-[var(--ic-muted)] block">Nom affiché (portail, emails, rapports)</label>
            <input className={inp} value={brand} onChange={e => setBrand(e.target.value)} />
            <label className="text-xs text-[var(--ic-muted)] block">Couleur principale</label>
            <div className="flex gap-2 items-center"><input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-10 h-10 rounded cursor-pointer bg-transparent" /><input className={inp} value={color} onChange={e => setColor(e.target.value)} /></div>
            <label className="text-xs text-[var(--ic-muted)] block">Logo (PNG/SVG)</label>
            <div className="flex items-center gap-3">
              {logo ? <img src={logo} alt="logo" className="h-10 w-auto rounded bg-[var(--ic-surface)] p-1" /> : <div className="h-10 w-20 rounded bg-[var(--ic-surface)] grid place-items-center text-[10px] text-[var(--ic-muted)]">aucun</div>}
              <label className={`${inp} !w-auto cursor-pointer text-center inline-flex items-center gap-2 justify-center`}><Upload className="w-4 h-4" /> Charger<input type="file" accept="image/*" className="hidden" onChange={onLogo} /></label>
            </div>
            <label className="flex items-center gap-2 text-sm pt-2 cursor-pointer">
              <input type="checkbox" checked={hideVendor} onChange={e => setHideVendor(e.target.checked)} className="accent-cyan-500" />
              Masquer totalement Infracentra (full white-label)
            </label>
          </div>
        </Card>
        <Card title="Domaine personnalisé & emails" icon={Globe}>
          <div className="space-y-3">
            <label className="text-xs text-[var(--ic-muted)] block">CNAME portail (ex : soc.votredomaine.ma)</label>
            <input className={inp} value={domain} onChange={e => setDomain(e.target.value)} placeholder="soc.atlascyber.ma" />
            <div className="text-xs bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg p-3 font-mono">
              Enregistrez chez votre hébergeur DNS :<br />
              <span className="text-cyan-400">{domain.split('.')[0] || 'soc'}. CNAME → {partner.branding.cname_target}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <StatusBadge s={partner.branding.dns_status === 'verified' ? 'active' : partner.branding.dns_status === 'pending_verification' ? 'onboarding' : 'suspended'} />
              <span className="text-[var(--ic-muted)]">{partner.branding.dns_status === 'verified' ? 'Domaine vérifié — portail servi sur votre nom.' : partner.branding.dns_status === 'pending_verification' ? 'En attente de propagation DNS.' : 'Aucun domaine configuré (défaut infracentra.io).'}</span>
            </div>
            <button onClick={verify} className="cursor-pointer text-sm border border-[var(--ic-border)] rounded-lg px-3 py-1.5 hover:border-cyan-500 inline-flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> Vérifier maintenant</button>
            <label className="text-xs text-[var(--ic-muted)] block pt-2">Expéditeur des notifications (vos clients reçoivent les alertes « de » cette adresse)</label>
            <input className={inp} value={sender} onChange={e => setSender(e.target.value)} placeholder="alerts@votredomaine.ma" />
          </div>
        </Card>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="cursor-pointer rounded-xl px-5 py-2.5 font-semibold text-slate-900 disabled:opacity-50" style={{ background: color }}>{saving ? 'Enregistrement…' : 'Enregistrer le branding'}</button>
        {done && <span className="text-emerald-400 text-sm flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> {done}</span>}
      </div>
    </div>
  );
}

// ===========================================================================
// 5. TEAM TRAINING — what we owe them (formation)
// ===========================================================================
// ---------------------------------------------------------------------------
// 5. TEAM TRAINING — progress + live lab scheduling (Teams / Zoom / Meet)
//    and custom modules added by the partner. Sessions persist in the demo
//    store (POST /partner/training/sessions) / real backend parity.
// ---------------------------------------------------------------------------
interface LabSession { id: number; module: string; platform: string; date: string; time: string; duration: string; trainer: string; link: string; status: 'Scheduled' | 'Completed'; }

function makeMeetingLink(platform: string, module: string): string {
  const slug = module.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24);
  const rnd = Math.random().toString(36).slice(2, 7);
  if (platform === 'Microsoft Teams') return `https://teams.microsoft.com/l/meetup-join/ic-${slug}/${rnd}`;
  if (platform === 'Zoom') return `https://zoom.us/j/${Math.floor(100000000 + Math.random() * 899999999)}?pwd=ic${rnd}`;
  if (platform === 'Google Meet') return `https://meet.google.com/ic-${slug.slice(0, 3)}-${rnd}-x`;
  return 'in-person — salle de lab Infracentra (Casablanca)';
}

export function PartnerTrainingPage() {
  const { partner, loading, error, reload } = usePartnerData();
  const [sessions, setSessions] = useState<LabSession[]>([
    { id: 1, module: 'SIEM & Triage IA', platform: 'Microsoft Teams', date: '2026-11-05', time: '14:00', duration: '2 h', trainer: 'Y. El Amrani (Infracentra)', link: 'https://teams.microsoft.com/l/meetup-join/ic-siem-triage/xk41p', status: 'Scheduled' },
  ]);
  const [showSched, setShowSched] = useState(false);
  const [sf, setSf] = useState({ module: '', platform: 'Microsoft Teams', date: '', time: '14:00', duration: '2 h', trainer: '' });
  const [customModule, setCustomModule] = useState('');
  const [modules, setModules] = useState<string[] | null>(null); // extra partner modules
  if (loading) return <Loader />;
  if (error || !partner) return <ErrorBox msg={error ?? ''} onRetry={reload} />;
  const t = partner.training;
  const pendingAll = [...(modules ? modules.filter(m => !t.completed.includes(m)) : []), ...t.pending];
  const total = t.completed.length + t.pending.length + (modules?.length ?? 0) || 1;
  const schedule = () => {
    if (!sf.module || !sf.date) return;
    const s: LabSession = { id: Date.now(), module: sf.module, platform: sf.platform, date: sf.date, time: sf.time, duration: sf.duration, trainer: sf.trainer || 'Account manager Infracentra', link: makeMeetingLink(sf.platform, sf.module), status: 'Scheduled' };
    setSessions(prev => [...prev, s]);
    try { fetch('/api/partner/training/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) }).catch(() => { /* demo: local only */ }); } catch { /* offline demo ok */ }
    setShowSched(false);
    setSf({ module: '', platform: 'Microsoft Teams', date: '', time: '14:00', duration: '2 h', trainer: '' });
  };
  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-xl font-bold">Formation de votre équipe</h1><p className="text-sm text-[var(--ic-muted)]">Inclus dans votre contrat — maintenu par Infracentra à chaque release.</p></div>
        <button onClick={() => setShowSched(v => !v)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[var(--ic-heading)] text-sm font-medium" style={{ background: partner.branding.primary_color }}>＋ Planifier une session lab</button>
      </header>

      {showSched && (
        <Card title="Nouvelle session de formation" icon={Clock}>
          <div className="grid md:grid-cols-3 gap-3">
            <label className="text-xs text-[var(--ic-muted)]">Module*
              <input list="pm-modules" className="mt-1 w-full bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={sf.module} onChange={e => setSf({ ...sf, module: e.target.value })} placeholder="ex : Playbooks SOAR avancés" />
              <datalist id="pm-modules">{pendingAll.map(m => <option key={m} value={m} />)}</datalist>
            </label>
            <label className="text-xs text-[var(--ic-muted)]">Plateforme
              <select className="mt-1 w-full bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={sf.platform} onChange={e => setSf({ ...sf, platform: e.target.value })}>
                {['Microsoft Teams', 'Zoom', 'Google Meet', 'In-person'].map(p => <option key={p}>{p}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--ic-muted)]">Formateur
              <input className="mt-1 w-full bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={sf.trainer} onChange={e => setSf({ ...sf, trainer: e.target.value })} placeholder="Infracentra ou interne" />
            </label>
            <label className="text-xs text-[var(--ic-muted)]">Date*<input type="date" className="mt-1 w-full bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={sf.date} onChange={e => setSf({ ...sf, date: e.target.value })} /></label>
            <label className="text-xs text-[var(--ic-muted)]">Heure<input type="time" className="mt-1 w-full bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={sf.time} onChange={e => setSf({ ...sf, time: e.target.value })} /></label>
            <label className="text-xs text-[var(--ic-muted)]">Durée
              <select className="mt-1 w-full bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={sf.duration} onChange={e => setSf({ ...sf, duration: e.target.value })}>
                {['1 h', '2 h', '½ journée', 'Journée complète', 'Lab 2 jours'].map(d => <option key={d}>{d}</option>)}
              </select>
            </label>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={schedule} disabled={!sf.module || !sf.date} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-[var(--ic-heading)] text-sm font-medium">Générer le lien & planifier</button>
            <button onClick={() => setShowSched(false)} className="px-4 py-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-text)] text-sm">Annuler</button>
          </div>
        </Card>
      )}

      <Card title="Progression" icon={GraduationCap}>
        <div className="flex justify-between text-sm mb-2"><span>{t.completed.length} modules validés sur {total}</span><b style={{ color: partner.branding.primary_color }}>{Math.round((t.completed.length / total) * 100)} %</b></div>
        <ProgressBar pct={(t.completed.length / total) * 100} color={partner.branding.primary_color} />
      </Card>

      <Card title="Sessions planifiées" icon={CalendarDays}>
        {sessions.length === 0 && <p className="text-sm text-[var(--ic-muted)]">Aucune session planifiée.</p>}
        <ul className="space-y-2 text-sm">
          {sessions.map(s => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 bg-[var(--ic-surface-2)] rounded-lg px-3 py-2">
              <span className="text-[var(--ic-heading)] font-medium">{s.module}</span>
              <span className="text-[var(--ic-muted)] text-xs">{s.platform} · {s.date} {s.time} · {s.duration} · {s.trainer}</span>
              <a href={s.link} target="_blank" rel="noreferrer" className="text-xs px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-[var(--ic-heading)] font-semibold">Rejoindre ↗</a>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid md:grid-cols-2 gap-5">
        <Card title="Validé" icon={CheckCircle2}>
          <ul className="space-y-2 text-sm">{t.completed.map(x => <li key={x} className="flex gap-2 text-emerald-400"><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />{x}</li>)}
            {t.completed.length === 0 && <li className="text-[var(--ic-muted)]">Aucun module validé pour l’instant.</li>}</ul>
        </Card>
        <Card title="À programmer" icon={Clock}>
          <ul className="space-y-2 text-sm">{pendingAll.map(x => <li key={x} className="flex gap-2 text-amber-400"><Clock className="w-4 h-4 shrink-0 mt-0.5" />{x}</li>)}
            {pendingAll.length === 0 && <li className="text-[var(--ic-muted)]">Toutes les formations sont à jour.</li>}</ul>
          <form className="flex gap-2 mt-4" onSubmit={e => { e.preventDefault(); const v = customModule.trim(); if (v) { setModules([...(modules ?? []), v]); setCustomModule(''); } }}>
            <input value={customModule} onChange={e => setCustomModule(e.target.value)} placeholder="Ajouter un module (ex : durcissement Fortinet)" className="flex-1 bg-[var(--ic-surface)] rounded-lg px-3 py-1.5 text-sm text-[var(--ic-heading)] placeholder-slate-500" />
            <button className="px-3 py-1.5 rounded-lg bg-[var(--ic-surface-2)] hover:bg-slate-600 text-[var(--ic-heading)] text-sm">＋</button>
          </form>
          <p className="text-[11px] text-[var(--ic-muted)] mt-3">Sessions live + lab dédié fournis — générez automatiquement un lien Teams / Zoom / Meet ci-dessus.</p>
        </Card>
      </div>
    </div>
  );
}

// ===========================================================================
// 6. VALUE & LOYALTY — the PARTNER program (different from client loyalty)
// ===========================================================================
export function PartnerValuePage() {
  const { partner, loading, error, reload } = usePartnerData();
  const value: PartnerValueProfile | null = useMemo(() => (partner ? partnerValueProfile(partner) : null), [partner]);
  if (loading) return <Loader />;
  if (error || !partner || !value) return <ErrorBox msg={error ?? ''} onRetry={reload} />;
  const compLabels: Record<string, string> = { revenue_growth: 'Croissance du revenu', retention: 'Rétention de mes clients', training: 'Adoption formation', whitelabel: 'Maturité white-label', support_quality: 'Qualité support' };

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-xl font-bold">Value & Loyalty — Programme Partenaire</h1>
          <p className="text-sm text-[var(--ic-muted)]">Un système distinct de la fidélité client : ici vous êtes évalués sur votre activité de canal.</p></div>
        <span className="px-4 py-2 rounded-full font-bold text-sm border" style={{ borderColor: partner.branding.primary_color, color: partner.branding.primary_color }}>Tier {value.tier}</span>
      </header>

      <div className="grid md:grid-cols-4 gap-4">
        <Kpi label="Score partenaire" value={`${value.score}/100`} sub={value.next_tier ? `+${value.points_to_next_tier} pts → ${value.next_tier}` : 'Palier maximum'} accent={partner.branding.primary_color} />
        <Kpi label="NRR portefeuille" value={`${value.nrr_pct}%`} sub="revenu net conservé" accent="#34d399" />
        <Kpi label="CSAT moyen" value={`${value.csat}/5`} sub="satisfaction vos clients" accent="#22d3ee" />
        <Kpi label="Ancienneté" value={`${value.months_as_partner} mois`} sub={`depuis ${new Date(partner.signed_on).toLocaleDateString('fr-FR')}`} accent="#a78bfa" />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Card title="Composition du score" icon={TrendingUp}>
          <div className="space-y-3">
            {Object.entries(value.components).map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between text-sm mb-1"><span className="text-[var(--ic-muted)]">{compLabels[k]}</span><b>{v}</b></div>
                <ProgressBar pct={v} color={v >= 75 ? '#34d399' : v >= 50 ? '#fbbf24' : '#fb7185'} />
              </div>
            ))}
            <p className="text-[11px] text-[var(--ic-muted)]">Pondérations : croissance 30 % · rétention 25 % · formation 15 % · white-label 15 % · support 15 %.</p>
          </div>
        </Card>
        <Card title="Historique 8 mois" icon={BarChart3}>
          <MiniLine data={value.history.map(h => h.mrr_eur)} color={partner.branding.primary_color} />
          <div className="grid grid-cols-4 gap-2 mt-4 text-center">
            {value.history.slice(-4).map(h => (<div key={h.month} className="bg-[var(--ic-surface)] rounded-lg p-2"><div className="text-xs font-bold text-emerald-400">{fmtEur(h.mrr_eur)}</div><div className="text-[10px] text-[var(--ic-muted)]">{h.month} · {h.clients} cl.</div></div>))}
          </div>
        </Card>
      </div>

      <Card title="Récompenses du programme" icon={Award}>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {value.rewards.map(r => (
            <div key={r.id} className={`rounded-xl border p-4 ${r.earned ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-[var(--ic-border)] bg-[var(--ic-surface)]'}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">{r.name}</span>
                {r.earned ? <span className="text-emerald-400 flex items-center gap-1 text-xs"><CheckCircle2 className="w-4 h-4" /> Acquis</span> : <span className="text-[var(--ic-muted)] text-xs">{r.progress}%</span>}
              </div>
              <p className="text-xs text-[var(--ic-muted)] mt-1">{r.description}</p>
              {!r.earned && <div className="mt-2"><ProgressBar pct={r.progress ?? 0} color="#64748b" /></div>}
              <div className="text-[10px] text-[var(--ic-muted)] mt-2">Tier min. {r.min_tier} · score ≥ {r.min_score}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Paliers du programme partenaire" icon={Star}>
        <div className="grid md:grid-cols-3 gap-3">
          {partnerProgramTiers.map(t => (
            <div key={t.tier} className={`rounded-xl border p-4 ${t.tier === value.tier ? 'border-cyan-500/50 bg-cyan-500/5' : 'border-[var(--ic-border)]'}`}>
              <div className="font-bold">{t.tier} {t.tier === value.tier && <span className="text-[10px] text-cyan-400 ml-1">← vous</span>}</div>
              <div className="text-[11px] text-[var(--ic-muted)]">Score ≥ {t.min_score}</div>
              <ul className="text-xs text-[var(--ic-muted)] mt-2 space-y-1">{t.perks.map(p => <li key={p}>• {p}</li>)}</ul>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ===========================================================================
// PARTNER SETTINGS HUB — used by the /settings page when role = partner_admin.
// Centralises EVERYTHING: Profile · Security (2FA) · Branding & Domain ·
// Licensing & Usage · Password Manager (change + email reset link).
// ===========================================================================
export function PartnerSettingsHub() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'profile' | 'security' | 'branding' | 'licensing' | 'password'>('profile');
  // ---- password manager state ----
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [resetSent, setResetSent] = useState<string | null>(null);
  const strong = (s: string) => s.length >= 10 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s) && /[^A-Za-z0-9]/.test(s);
  const changePassword = async () => {
    setPwMsg(null);
    if (!strong(pw.next)) { setPwMsg({ kind: 'err', text: 'Mot de passe trop faible : 10+ caractères, majuscule, minuscule, chiffre et symbole.' }); return; }
    if (pw.next !== pw.confirm) { setPwMsg({ kind: 'err', text: 'La confirmation ne correspond pas.' }); return; }
    try {
      await fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_password: pw.current, new_password: pw.next }) }).catch(() => {});
      setPwMsg({ kind: 'ok', text: 'Mot de passe mis à jour. Toutes les autres sessions ont été déconnectées.' });
      setPw({ current: '', next: '', confirm: '' });
    } catch { setPwMsg({ kind: 'err', text: 'Changement impossible — réessayez.' }); }
  };
  const sendReset = async () => {
    const email = user?.email ?? '';
    setResetSent(email);
    try { await fetch('/api/auth/password-reset-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }).catch(() => {}); } catch { /* demo ok */ }
    setTimeout(() => setPwMsg({ kind: 'ok', text: `Lien de réinitialisation envoyé à ${email} — valide 30 minutes.` }), 400);
  };

  const tabs: { id: typeof tab; label: string; icon: any }[] = [
    { id: 'profile', label: 'Profile', icon: Building2 },
    { id: 'security', label: 'Security (2FA)', icon: ShieldCheck },
    { id: 'branding', label: 'Branding & Domain', icon: Palette },
    { id: 'licensing', label: 'Licensing & Usage', icon: Percent },
    { id: 'password', label: 'Password Manager', icon: KeyRound },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition ${tab === t.id ? 'bg-cyan-500/10 text-cyan-400 border-[var(--ic-border)]' : 'text-[var(--ic-muted)] hover:text-[var(--ic-heading)] hover:bg-[var(--ic-surface-2)] border-transparent'}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {pwMsg && <div className={`text-sm rounded-lg p-3 border ${pwMsg.kind === 'ok' ? 'bg-emerald-900/30 border-emerald-800 text-emerald-300' : 'bg-red-900/30 border-red-800 text-red-300'}`}>{pwMsg.text}</div>}

      {tab === 'profile' && (
        <Card title="Profil partenaire" icon={Building2}>
          <p className="text-sm text-[var(--ic-text)]">Raison sociale, contact principal et coordonnées facturées.</p>
          <ul className="mt-3 space-y-1 text-sm text-[var(--ic-muted)]">
            <li><b className="text-[var(--ic-heading)]">{user?.name ?? 'Compte partenaire'}</b> — {user?.email}</li>
            <li>Gérez vos end-clients dans la section <i>My Clients</i> ; votre marque s’applique automatiquement au portail de vos clients.</li>
          </ul>
        </Card>
      )}

      {tab === 'security' && (
        <Card title="Sécurité du compte" icon={ShieldCheck}>
          <div className="flex items-center justify-between bg-[var(--ic-surface-2)] rounded-lg px-4 py-3">
            <div><p className="text-sm text-[var(--ic-heading)]">Authentification à deux facteurs (TOTP)</p><p className="text-xs text-[var(--ic-muted)]">Obligatoire pour tous les comptes partenaires — protège le provisioning de vos clients.</p></div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold">Activée</span>
          </div>
          <div className="flex items-center justify-between bg-[var(--ic-surface-2)] rounded-lg px-4 py-3 mt-3">
            <div><p className="text-sm text-[var(--ic-heading)]">Sessions actives</p><p className="text-xs text-[var(--ic-muted)]">Appareils connectés sur ce compte.</p></div>
            <span className="text-xs text-[var(--ic-muted)]">1 session · Casablanca, MA</span>
          </div>
        </Card>
      )}

      {tab === 'branding' && <div className="space-y-5"><PartnerBrandingPage /></div>}
      {tab === 'licensing' && <div className="space-y-5"><PartnerLicensingPage /></div>}

      {tab === 'password' && (
        <div className="grid md:grid-cols-2 gap-5">
          <Card title="Changer le mot de passe" icon={KeyRound}>
            <div className="space-y-3">
              <input type="password" className="w-full bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" placeholder="Mot de passe actuel" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} />
              <input type="password" className="w-full bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" placeholder="Nouveau mot de passe (politique : 10+, Aa, 0-9, $)" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} />
              {pw.next && <p className={`text-[11px] ${strong(pw.next) ? 'text-emerald-400' : 'text-amber-400'}`}>{strong(pw.next) ? '✓ Force suffisante' : '⚠ 10+ caractères avec majuscule, minuscule, chiffre et symbole'}</p>}
              <input type="password" className="w-full bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" placeholder="Confirmer le nouveau mot de passe" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} />
              <button onClick={changePassword} disabled={!pw.current || !pw.next} className="w-full px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-[var(--ic-heading)] text-sm font-medium">Mettre à jour</button>
            </div>
          </Card>
          <Card title="Réinitialisation par email" icon={Mail}>
            <p className="text-sm text-[var(--ic-muted)]">Vous avez oublié votre mot de passe ? Envoyez un lien sécurisé (valide 30 min) dans votre boîte de réception {user?.email}.</p>
            <button onClick={sendReset} className="mt-4 w-full px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-[var(--ic-heading)] text-sm font-medium inline-flex items-center justify-center gap-2">
              <Mail className="w-4 h-4" />{resetSent ? 'Renvoyer le lien de réinitialisation' : "Envoyer le lien à ma boîte mail"}
            </button>
            <p className="text-[11px] text-[var(--ic-muted)] mt-3">L’email est émis par le moteur de notifications Infracentra (SMTP chiffré TLS). Le lien n’expose jamais votre mot de passe.</p>
          </Card>
        </div>
      )}
    </div>
  );
}
