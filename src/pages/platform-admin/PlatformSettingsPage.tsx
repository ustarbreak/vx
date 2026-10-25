// ---------------------------------------------------------------------------
// PlatformSettingsPage — platform-admin configuration hub (Phase 4).
// Route: /admin/settings (sidebar "Platform Settings" for platform_admin only).
// Sections:
//   • Setup & Démo rapide  → the SetupPanel moved OUT of the dashboard
//   • Thème plateforme     → quick link to /admin/themes (Infracentra Themes)
//   • Audit plateforme     → live log of admin actions (grants, rules, partners,
//                            tickets created for clients) via /admin/audit-platform
//   • Sécurité de session  → read-only view of current security settings
// ---------------------------------------------------------------------------
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Settings as SettingsIcon, Inbox, Radio, Palette, ScrollText, ShieldCheck, RefreshCw, Wand2 } from 'lucide-react';
import { tenantManagerApi, settingsApi, pushDemoEvents } from '../../services/api';

/**
 * SetupPanel — MOVED here from PlatformDashboardPage (it was private there).
 * Exported so both this page and (optionally) other platform views can use it.
 */
export function SetupPanel() {
  const [busy, setBusy] = useState<'seed' | 'demo' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const seed = async () => {
    setBusy('seed'); setErr(null); setMsg(null);
    try {
      const res = await settingsApi.seedDemoTenant();
      setMsg(`Tenant créé : ${res?.organization?.name ?? 'Damanecash'} — compte client : admin@damanecash.ma / Client#2026`);
    } catch (e: any) {
      setErr(e?.message?.includes('409') ? 'Le tenant de démo existe déjà.' : (e?.message || 'Échec du seed.'));
    } finally { setBusy(null); }
  };

  const demo = async () => {
    setBusy('demo'); setErr(null); setMsg(null);
    try {
      let orgId: number | undefined;
      try {
        const ov = await settingsApi.overview();
        orgId = (ov as any)?.organizations?.[0]?.id ?? (ov as any)?.tenants?.[0]?.id;
      } catch { /* ignore */ }
      const res = await pushDemoEvents(orgId);
      setMsg(`${res.alerts} alertes injectées dans le vrai pipeline → ${res.tickets.length} ticket(s) auto-créé(s)${res.tickets.length ? ' : ' + res.tickets.join(', ') : ''}`);
    } catch (e: any) {
      setErr(e?.message || 'Échec de l\'injection des événements de démo.');
    } finally { setBusy(null); }
  };

  return (
    <div className="bg-[var(--ic-surface)] border border-purple-800/40 rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Wand2 className="w-5 h-5 text-purple-400" />
        <h2 className="text-lg font-semibold text-[var(--ic-heading)]">Setup &amp; Démo rapide</h2>
      </div>
      <p className="text-sm text-[var(--ic-muted)]">
        1️⃣ Créez un tenant client (admin + règles d'auto-ticketing), 2️⃣ injectez des alertes d'exemple
        dans le vrai backend — corrélation, notifications et tickets sont générés pour de vrai.
      </p>
      <div className="flex flex-wrap gap-3">
        <button onClick={seed} disabled={busy !== null}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-[var(--ic-heading)] text-sm font-medium disabled:opacity-50">
          {busy === 'seed' && <Loader2 className="w-4 h-4 animate-spin" />} Seed demo tenant
        </button>
        <button onClick={demo} disabled={busy !== null}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-[var(--ic-heading)] text-sm font-medium disabled:opacity-50">
          {busy === 'demo' && <Loader2 className="w-4 h-4 animate-spin" />} Push demo alerts
        </button>
        <Link to="/client-admin/advanced-tickets" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--ic-surface-2)] hover:bg-[var(--ic-border)] text-[var(--ic-heading)] text-sm font-medium">
          <Inbox className="w-4 h-4" /> Advanced Ticketing
        </Link>
        <Link to="/client-admin/notifications" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--ic-surface-2)] hover:bg-[var(--ic-border)] text-[var(--ic-heading)] text-sm font-medium">
          <Radio className="w-4 h-4" /> Notification Engine
        </Link>
      </div>
      {msg && <p className="text-sm text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 rounded-lg px-3 py-2">{msg}</p>}
      {err && <p className="text-sm text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{err}</p>}
    </div>
  );
}

interface PlatformAuditRow { id: number; action: string; detail: string; actor: string; created_at: string }

export default function PlatformSettingsPage() {
  const [audit, setAudit] = useState<PlatformAuditRow[]>([]);
  const [auditErr, setAuditErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAudit = () => {
    setLoading(true);
    tenantManagerApi.platformAudit()
      .then(rows => { setAudit(rows); setAuditErr(null); })
      .catch(e => setAuditErr(e?.message ?? 'Audit plateforme indisponible (backend réel : route /admin/audit-platform à déployer avec la phase 4).'))
      .finally(() => setLoading(false));
  };
  useEffect(loadAudit, []);

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2"><SettingsIcon className="w-6 h-6 text-purple-400" /> Paramètres Plateforme</h1>
          <p className="text-sm text-[var(--ic-muted)] mt-1">Configuration réservée aux administrateurs Infracentra — provisioning, thème par défaut, journal d'actions admin.</p>
        </div>
        <Link to="/settings" className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--ic-border)] text-sm text-[var(--ic-text)] hover:border-purple-500">
          <SettingsIcon className="w-4 h-4" /> Configuration système complète
        </Link>
      </div>

      {/* Setup panel — relocated from the dashboard */}
      <SetupPanel />

      {/* Quick links */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Link to="/admin/themes" className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-5 hover:border-purple-500 transition-colors">
          <div className="flex items-center gap-2 mb-2"><Palette className="w-5 h-5 text-amber-400" /><h3 className="font-semibold text-[var(--ic-heading)]">Thème plateforme par défaut</h3></div>
          <p className="text-sm text-[var(--ic-muted)]">Choisir entre « Calm Operations » (clair) et « Cyber Modern » (sombre) pour tous les nouveaux visiteurs.</p>
        </Link>
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2"><ShieldCheck className="w-5 h-5 text-emerald-400" /><h3 className="font-semibold text-[var(--ic-heading)]">Sécurité de session</h3></div>
          <ul className="text-sm text-[var(--ic-muted)] space-y-1 list-disc list-inside">
            <li>MFA obligatoire pour platform_admin & client_admin (voir Settings → MFA)</li>
            <li>Sessions JWT : accès API et expiration gérés dans Configuration système</li>
            <li>Chaque action sensible est journalisée (hash immuable, Audit Log)</li>
          </ul>
        </div>
      </div>

      {/* Platform audit trail */}
      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--ic-border)]">
          <h3 className="font-semibold text-[var(--ic-heading)] flex items-center gap-2"><ScrollText className="w-5 h-5 text-cyan-400" /> Journal des actions admin (audit plateforme)</h3>
          <button onClick={loadAudit} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-[var(--ic-heading)]"><RefreshCw className="w-3.5 h-3.5" /> Actualiser</button>
        </div>
        {loading
          ? <div className="p-6 flex items-center gap-2 text-sm text-[var(--ic-muted)]"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</div>
          : auditErr
            ? <div className="p-6 text-sm text-amber-300">{auditErr}</div>
            : audit.length === 0
              ? <div className="p-6 text-sm text-[var(--ic-muted)]">Aucune action admin enregistrée pour l'instant — créez une règle, un grant ou un ticket depuis un Tenant Detail.</div>
              : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-[var(--ic-muted)] border-b border-[var(--ic-border)]">
                    <th className="px-5 py-2">Quand</th><th className="px-5 py-2">Action</th><th className="px-5 py-2">Détail</th><th className="px-5 py-2">Acteur</th></tr></thead>
                  <tbody>
                    {audit.map(a => (
                      <tr key={a.id} className="border-b border-[var(--ic-border)] last:border-0">
                        <td className="px-5 py-2.5 text-[var(--ic-muted)] whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                        <td className="px-5 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[11px] font-mono border ${
                          a.action.includes('entitlement') ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                          : a.action.includes('partner') ? 'bg-cyan-500/10 text-cyan-300 border-[var(--ic-border)]'
                          : a.action.includes('rule') ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                          : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'}`}>{a.action}</span></td>
                        <td className="px-5 py-2.5 text-[var(--ic-text)]">{a.detail}</td>
                        <td className="px-5 py-2.5 font-mono text-xs text-[var(--ic-muted)]">{a.actor}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
      </div>
    </div>
  );
}
