// ---------------------------------------------------------------------------
// Platform Admin — Partner Program (MSP) management page.
// Lives ONLY in the platform-admin navigation: client admins never see it.
// Shows partners, licensing (seats/devices/plans), white-label status
// (brand, custom domain, CNAME verification) and each partner's end-clients.
// Data comes from /partners via partnersApi → demoStore in Demo Mode, real
// backend when deployed. Same shapes either way.
// ---------------------------------------------------------------------------
import React, { useEffect, useState } from 'react';
import { Users2, Building, Server, Percent, Palette, Globe, CheckCircle2, Clock, XCircle, Loader2, RefreshCw, GraduationCap, Headphones, PauseCircle, PlayCircle, ArrowRightLeft, Trash2, PencilLine } from 'lucide-react';
import { partnersApi, type PartnerProgramStats } from '../../services/partnersApi';
import { partnersAdminApi } from '../../services/api';
import type { Partner } from '../../data/partnerWorld';

const fmtEur = (n: number) => `${n.toLocaleString('fr-FR')} €`;

const dnsBadge = (s: string) =>
  s === 'verified'
    ? <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 className="w-3.5 h-3.5" /> Vérifié</span>
    : s === 'pending_verification'
      ? <span className="inline-flex items-center gap-1 text-amber-400"><Clock className="w-3.5 h-3.5" /> En attente DNS</span>
      : <span className="inline-flex items-center gap-1 text-[var(--ic-muted)]"><XCircle className="w-3.5 h-3.5" /> Non configuré</span>;

const statusBadge: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  trial: 'bg-cyan-500/15 text-cyan-400 border-[var(--ic-primary)]',
  prospect: 'bg-slate-500/15 text-[var(--ic-muted)] border-slate-500/30',
  suspended: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
};

export default function PlatformPartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [stats, setStats] = useState<PartnerProgramStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ company: '', contact_name: '', contact_email: '', tier: '' });

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [ps, st] = await Promise.all([partnersApi.list(), partnersApi.stats()]);
      setPartners(ps); setStats(st);
    } catch (e: any) {
      setError(e?.message ?? 'Impossible de charger le programme partenaires.');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // ---- Actions de gestion (miroir exact demoMode.ts + routers/partners_admin.py) ----
  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    try { await fn(); await load(); }
    catch (e: any) { alert(`Échec de l'action : ${e?.message ?? 'erreur inconnue'}`); }
    finally { setBusyId(null); }
  };
  const suspend = (p: Partner) => act(p.id, () => partnersAdminApi.suspend(p.id));
  const reactivate = (p: Partner) => act(p.id, () => partnersAdminApi.update(p.id, { status: 'active' }));
  const migrate = (p: Partner) => {
    const target = window.prompt(`Migrer ${p.company} vers un nouveau plan licence (Starter / Business / Scale) — actuel : ${p.license.plan}`, p.license.plan);
    if (!target || !['Starter', 'Business', 'Scale'].includes(target)) return;
    void act(p.id, () => partnersAdminApi.migrate(p.id, target as 'Starter' | 'Business' | 'Scale'));
  };
  const remove = (p: Partner) => {
    if (!window.confirm(`Supprimer définitivement le partenaire « ${p.company} » ? Ses clients finaux seront migrés vers Infracentra direct.`)) return;
    void act(p.id, () => partnersAdminApi.remove(p.id));
  };
  const startEdit = (p: Partner) => {
    setEditId(p.id);
    setEditForm({ company: p.company, contact_name: p.contact_name, contact_email: p.contact_email, tier: p.tier });
  };
  const saveEdit = () => {
    if (!editId) return;
    void act(editId, () => partnersAdminApi.update(editId, editForm)).then(() => setEditId(null));
  };

  if (loading) return <div className="flex items-center gap-3 text-[var(--ic-muted)] p-8"><Loader2 className="w-5 h-5 animate-spin" /> Chargement du programme partenaires…</div>;
  if (error) return <div className="p-8"><div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl p-4 flex items-center justify-between">{error}<button onClick={load} className="inline-flex items-center gap-1 text-sm border border-rose-500/40 rounded-lg px-3 py-1 hover:bg-rose-500/20"><RefreshCw className="w-3.5 h-3.5" /> Réessayer</button></div></div>;

  const kpis = stats ? [
    { icon: Users2, label: 'Partenaires', value: `${stats.partners_active} actifs · ${stats.trials} essai`, color: 'text-purple-400' },
    { icon: Building, label: 'Clients finaux gérés', value: String(stats.end_clients), color: 'text-cyan-400' },
    { icon: Server, label: 'Devices supervisés (canal)', value: stats.devices_managed.toLocaleString('fr-FR'), color: 'text-blue-400' },
    { icon: Percent, label: 'Marge canal', value: `${stats.channel_margin_pct} %`, color: 'text-emerald-400' },
    { icon: Palette, label: 'White-labels actifs', value: `${stats.white_labels_live} / ${stats.partners_total}`, color: 'text-amber-400' },
    { icon: Globe, label: 'Domaines en attente DNS', value: String(stats.dns_pending), color: stats.dns_pending ? 'text-rose-400' : 'text-emerald-400' },
  ] : [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2"><Users2 className="w-6 h-6 text-purple-400" /> Programme Partenaires (MSP)</h1>
          <p className="text-[var(--ic-muted)] text-sm mt-1">Les partenaires revendent la plateforme sous leur propre marque. Infracentra assure la maintenance et la formation de leurs équipes.</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 border border-[var(--ic-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--ic-text)] hover:border-purple-500"><RefreshCw className="w-4 h-4" /> Actualiser</button>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
            <k.icon className={`w-5 h-5 ${k.color}`} />
            <div className="text-lg font-bold text-[var(--ic-heading)] mt-2">{k.value}</div>
            <div className="text-xs text-[var(--ic-muted)]">{k.label}</div>
          </div>
        ))}
      </div>

      {stats && (
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4 text-sm text-[var(--ic-text)] flex flex-wrap gap-x-8 gap-y-1">
          <span>Revenu wholesale (Infracentra) : <b className="text-[var(--ic-heading)]">{fmtEur(stats.wholesale_mrr_eur)} /mois</b></span>
          <span>Revenu retail canal : <b className="text-[var(--ic-heading)]">{fmtEur(stats.retail_mrr_eur)} /mois</b></span>
          <span className="text-[var(--ic-muted)]">Le partenaire facture ses clients finaux ; Infracentra ne facture que les licences partenaires.</span>
        </div>
      )}

      {/* Partner cards */}
      <div className="space-y-3">
        {partners.map(p => {
          const lic = p.license;
          const seatsPct = Math.round((lic.client_seats_used / lic.client_seats) * 100);
          const devPct = Math.round((lic.devices_used / lic.device_allowance) * 100);
          const open = openId === p.id;
          return (
            <div key={p.id} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
              <button onClick={() => setOpenId(open ? null : p.id)} className="w-full text-left p-4 flex flex-wrap items-center gap-x-6 gap-y-2 hover:bg-[var(--ic-surface)]">
                <span className="font-semibold text-[var(--ic-heading)]">{p.company}</span>
                <span className="text-xs text-[var(--ic-muted)]">{p.code} · {p.country} · {p.tier}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${statusBadge[p.status]}`}>{p.status}</span>
                <span className="ml-auto inline-flex items-center gap-1 text-xs" style={{ color: p.branding.primary_color }}>
                  <Palette className="w-3.5 h-3.5" /> {p.branding.brand_name} {dnsBadge(p.branding.dns_status)}
                </span>
                <span className="text-xs text-[var(--ic-muted)] w-40 text-right">{lic.plan} · {fmtEur(lic.price_month_eur)}/mois</span>
                <span className="text-xs text-[var(--ic-muted)]">{open ? '▲' : '▼'}</span>
              </button>

              {/* Barre d'actions gestion partenaire (miroir partnersAdminApi / routers/partners_admin.py) */}
              <div className="px-4 pb-3 -mt-1 flex flex-wrap gap-2">
                {busyId === p.id && <span className="inline-flex items-center gap-1 text-xs text-cyan-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Traitement…</span>}
                <button disabled={busyId === p.id} onClick={() => startEdit(p)}
                  className="inline-flex items-center gap-1 text-xs border border-[var(--ic-border)] rounded-lg px-2.5 py-1 text-[var(--ic-text)] hover:border-cyan-500 disabled:opacity-40">
                  <PencilLine className="w-3.5 h-3.5" /> Modifier</button>
                <button disabled={busyId === p.id} onClick={() => migrate(p)}
                  className="inline-flex items-center gap-1 text-xs border border-[var(--ic-border)] rounded-lg px-2.5 py-1 text-[var(--ic-text)] hover:border-purple-500 disabled:opacity-40">
                  <ArrowRightLeft className="w-3.5 h-3.5" /> Migrer le plan</button>
                {p.status === 'suspended'
                  ? <button disabled={busyId === p.id} onClick={() => reactivate(p)}
                      className="inline-flex items-center gap-1 text-xs border border-emerald-500/40 rounded-lg px-2.5 py-1 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40">
                      <PlayCircle className="w-3.5 h-3.5" /> Réactiver</button>
                  : <button disabled={busyId === p.id} onClick={() => suspend(p)}
                      className="inline-flex items-center gap-1 text-xs border border-amber-500/40 rounded-lg px-2.5 py-1 text-amber-400 hover:bg-amber-500/10 disabled:opacity-40">
                      <PauseCircle className="w-3.5 h-3.5" /> Suspendre</button>}
                <button disabled={busyId === p.id} onClick={() => remove(p)}
                  className="inline-flex items-center gap-1 text-xs border border-rose-500/40 rounded-lg px-2.5 py-1 text-rose-400 hover:bg-rose-500/10 disabled:opacity-40">
                  <Trash2 className="w-3.5 h-3.5" /> Supprimer</button>
              </div>

              {/* Formulaire d'édition inline */}
              {editId === p.id && (
                <div className="border-t border-[var(--ic-border)] bg-[var(--ic-bg)] p-4 grid md:grid-cols-4 gap-3 text-sm">
                  <label className="space-y-1"><span className="text-xs text-[var(--ic-muted)]">Société</span>
                    <input className="w-full border border-[var(--ic-border)] rounded-lg px-2 py-1 bg-[var(--ic-surface)] text-[var(--ic-text)]"
                      value={editForm.company} onChange={e => setEditForm({ ...editForm, company: e.target.value })} /></label>
                  <label className="space-y-1"><span className="text-xs text-[var(--ic-muted)]">Contact</span>
                    <input className="w-full border border-[var(--ic-border)] rounded-lg px-2 py-1 bg-[var(--ic-surface)] text-[var(--ic-text)]"
                      value={editForm.contact_name} onChange={e => setEditForm({ ...editForm, contact_name: e.target.value })} /></label>
                  <label className="space-y-1"><span className="text-xs text-[var(--ic-muted)]">E-mail</span>
                    <input className="w-full border border-[var(--ic-border)] rounded-lg px-2 py-1 bg-[var(--ic-surface)] text-[var(--ic-text)]"
                      value={editForm.contact_email} onChange={e => setEditForm({ ...editForm, contact_email: e.target.value })} /></label>
                  <label className="space-y-1"><span className="text-xs text-[var(--ic-muted)]">Palier</span>
                    <select className="w-full border border-[var(--ic-border)] rounded-lg px-2 py-1 bg-[var(--ic-surface)] text-[var(--ic-text)]"
                      value={editForm.tier} onChange={e => setEditForm({ ...editForm, tier: e.target.value })}>
                      {['Silver', 'Gold', 'Platinum'].map(t => <option key={t}>{t}</option>)}</select></label>
                  <div className="md:col-span-4 flex gap-2 justify-end">
                    <button onClick={() => setEditId(null)} className="text-xs border border-[var(--ic-border)] rounded-lg px-3 py-1.5 text-[var(--ic-muted)]">Annuler</button>
                    <button onClick={saveEdit} className="text-xs bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg px-3 py-1.5 font-medium">Enregistrer</button>
                  </div>
                </div>
              )}

              {open && (
                <div className="border-t border-[var(--ic-border)] p-4 grid lg:grid-cols-3 gap-4">
                  {/* Licensing */}
                  <div className="ic-page/60 border border-[var(--ic-border)] rounded-lg p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-[var(--ic-heading)] flex items-center gap-2"><Server className="w-4 h-4 text-cyan-400" /> Licence & quotas</h3>
                    {[['Sièges clients', lic.client_seats_used, lic.client_seats, seatsPct], ['Devices supervisés', lic.devices_used, lic.device_allowance, devPct]].map(([label, used, max, pct]: any) => (
                      <div key={label}>
                        <div className="flex justify-between text-xs text-[var(--ic-muted)]"><span>{label}</span><span>{used} / {max}</span></div>
                        <div className="h-2 bg-[var(--ic-surface)] rounded-full mt-1"><div className={`h-2 rounded-full ${pct > 85 ? 'bg-rose-500' : pct > 65 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                      </div>
                    ))}
                    <div className="text-xs text-[var(--ic-muted)]">Ticketing avancé : {lic.ticketing ? <span className="text-emerald-400">inclus</span> : <span className="text-[var(--ic-muted)]">non inclus</span>}</div>
                    <div className="text-xs text-[var(--ic-muted)]">Services concédés : {lic.services_included.includes('all') ? 'les 16 services' : `${lic.services_included.length} services`}</div>
                    <div className="text-xs text-[var(--ic-muted)]">Renouvellement : <span className="text-[var(--ic-heading)]">{lic.renews_on}</span> · Marge partenaire : <span className="text-emerald-400">{lic.margin_pct} %</span></div>
                  </div>

                  {/* White-label */}
                  <div className="ic-page/60 border border-[var(--ic-border)] rounded-lg p-4 space-y-2">
                    <h3 className="text-sm font-semibold text-[var(--ic-heading)] flex items-center gap-2"><Globe className="w-4 h-4 text-purple-400" /> Marque blanche</h3>
                    <dl className="text-xs space-y-1.5">
                      <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">Nom de marque</dt><dd className="text-[var(--ic-heading)] font-medium" style={{ color: p.branding.primary_color }}>{p.branding.brand_name}</dd></div>
                      <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">Domaine client</dt><dd className="text-[var(--ic-heading)] font-mono">{p.branding.custom_domain || '—'}</dd></div>
                      <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">Enregistrement CNAME</dt><dd className="text-[var(--ic-heading)] font-mono">{p.branding.cname_target}</dd></div>
                      <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">Expéditeur e-mails</dt><dd className="text-[var(--ic-heading)] font-mono">{p.branding.email_sender || '—'}</dd></div>
                      <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">Masquage Infracentra</dt><dd>{p.branding.hide_infracentra ? <span className="text-emerald-400">activé (white-label total)</span> : <span className="text-amber-400">partiel</span>}</dd></div>
                      <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">Statut DNS</dt><dd>{dnsBadge(p.branding.dns_status)}</dd></div>
                    </dl>
                    <p className="text-[11px] text-[var(--ic-muted)] leading-relaxed">Le partenaire crée un CNAME <span className="font-mono text-[var(--ic-muted)]">{p.branding.custom_domain.split('.')[0]} → {p.branding.cname_target}</span> dans sa zone DNS ; nos certificats TLS sont émis automatiquement après vérification.</p>
                  </div>

                  {/* Support + training + end clients */}
                  <div className="ic-page/60 border border-[var(--ic-border)] rounded-lg p-4 space-y-2">
                    <h3 className="text-sm font-semibold text-[var(--ic-heading)] flex items-center gap-2"><Headphones className="w-4 h-4 text-emerald-400" /> Notre engagement</h3>
                    <div className="text-xs text-[var(--ic-text)]">{p.support_sla}</div>
                    <div className="text-xs text-[var(--ic-muted)] flex items-center gap-1 pt-1"><GraduationCap className="w-3.5 h-3.5 text-cyan-400" /> Formations :</div>
                    <ul className="text-xs space-y-0.5">
                      {p.training.completed.map(t => <li key={t} className="text-emerald-400">✓ {t}</li>)}
                      {p.training.pending.map(t => <li key={t} className="text-[var(--ic-muted)]">○ {t}</li>)}
                    </ul>
                    <div className="pt-2 text-xs text-[var(--ic-muted)]">Contact : {p.contact_name} · <span className="font-mono">{p.contact_email}</span></div>
                  </div>

                  {/* End clients table full width */}
                  <div className="lg:col-span-3">
                    <h3 className="text-sm font-semibold text-[var(--ic-heading)] mb-2">Clients finaux du partenaire ({p.end_clients.length})</h3>
                    <div className="overflow-x-auto border border-[var(--ic-border)] rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-[var(--ic-surface)] text-[var(--ic-muted)]">
                          <tr>{['Client', 'Ville', 'Secteur', 'Devices', 'Utilisateurs', 'Plan vendu', 'ARR estimé', 'Statut'].map(h => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {p.end_clients.map(c => (
                            <tr key={c.id} className="border-t border-[var(--ic-border)] hover:bg-[var(--ic-surface)]">
                              <td className="px-3 py-2 text-[var(--ic-heading)]">{c.name}</td>
                              <td className="px-3 py-2 text-[var(--ic-muted)]">{c.city}</td>
                              <td className="px-3 py-2 text-[var(--ic-muted)]">{c.industry}</td>
                              <td className="px-3 py-2 text-[var(--ic-text)]">{c.devices}</td>
                              <td className="px-3 py-2 text-[var(--ic-text)]">{c.users}</td>
                              <td className="px-3 py-2 text-[var(--ic-text)]">{c.plan}</td>
                              <td className="px-3 py-2 text-emerald-400">{fmtEur(c.monthly_mrr_eur * 12)}</td>
                              <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full border text-[11px] ${statusBadge[c.status === 'active' ? 'active' : c.status === 'onboarding' ? 'trial' : 'suspended']}`}>{c.status}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
