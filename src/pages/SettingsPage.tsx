import React, { useCallback, useEffect, useState } from 'react';
import {
  User, Building2, Shield, Bell, Zap, Key, ToggleRight, ToggleLeft,
  CheckCircle2, Save, RefreshCw, ShieldAlert, Users, ScrollText, Play, UserPlus,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { serviceCatalog } from '../data/mockData';
import {
  settingsApi, SystemSettings, SettingsOverview, ApiError, DemoAccountRequest,
} from '../services/api';

const toggleDefs: { key: keyof SystemSettings; label: string; hint: string }[] = [
  { key: 'auto_ticketing', label: 'Auto-create tickets from alerts', hint: 'Every ingested alert matching a notification rule instantly opens a ticket in Advanced Ticketing.' },
  { key: 'sla_escalations', label: 'Automatic SLA escalations', hint: 'Background worker re-prioritises and escalates tickets as SLA deadlines near or breach.' },
  { key: 'email_enabled', label: 'Email delivery', hint: 'SMTP relay for email-channel notifications.' },
  { key: 'sms_enabled', label: 'SMS delivery', hint: 'Twilio-compatible gateway for SMS-channel notifications.' },
  { key: 'webhook_enabled', label: 'Outbound webhooks', hint: 'POST JSON payloads to the URL below on every routed event.' },
  { key: 'quiet_hours', label: 'Quiet hours', hint: 'Non-critical notifications are held overnight per-rule (critical always delivers).' },
];

export default function SettingsPage() {
  const { user, organization } = useAuth();
  const isPlatformAdmin = user?.role === 'platform_admin';
  const [activeTab, setActiveTab] = useState('demo-accounts');
  const [saved, setSaved] = useState(false);
  const [sys, setSys] = useState<SystemSettings | null>(null);
  const [draft, setDraft] = useState<SystemSettings | null>(null);
  const [overview, setOverview] = useState<SettingsOverview | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState('');

  // --- Demo Account generator (platform admins) — creates a REAL account in
  // the database for a real user, with chosen services + 30-day trial.
  const [daForm, setDaForm] = useState<DemoAccountRequest>({
    email: '', password: 'Trial#2026', org_name: '', service_ids: null, trial_days: 30,
  });
  const [daSelected, setDaSelected] = useState<string[]>(serviceCatalog.map(s => s.id));
  const [daIncludeTicketing, setDaIncludeTicketing] = useState(true);
  const [daAllServices, setDaAllServices] = useState(true);
  const [daCreating, setDaCreating] = useState(false);
  const [daResult, setDaResult] = useState('');
  const [daError, setDaError] = useState('');

  const createDemoAccount = async () => {
    setDaCreating(true); setDaResult(''); setDaError('');
    try {
      const ids = daAllServices
        ? [...serviceCatalog.map(s => s.id)]
        : [...daSelected];
      if (daIncludeTicketing && !ids.includes('advanced-ticketing')) ids.push('advanced-ticketing');
      const payload: DemoAccountRequest = {
        ...daForm,
        service_ids: ids.length === 0 ? null : ids,
      };
      const res = await settingsApi.createDemoAccount(payload);
      setDaResult(
        `✅ Trial account created in the database — org "${res.organization?.name}" (id ${res.organization?.id}), ` +
        `login: ${res.client_admin?.email} / ${daForm.password || 'Trial#2026'} · ` +
        `${payload.service_ids?.length ?? 17} services granted · expires in ${daForm.trial_days} days.`
      );
      setOverview(await settingsApi.overview());
    } catch (e: any) {
      setDaError(e instanceof ApiError ? e.message : String(e?.message ?? e));
    } finally { setDaCreating(false); }
  };

  const load = useCallback(async () => {
    try {
      const s = await settingsApi.get();
      setSys(s); setDraft(s);
      if (isPlatformAdmin) setOverview(await settingsApi.overview());
      setLoadErr('');
    } catch (e: any) {
      setLoadErr(e instanceof ApiError ? e.message : 'Backend unreachable — is the API container running?');
    }
  }, [isPlatformAdmin]);
  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!draft) return;
    try {
      const updated = await settingsApi.update(draft);   // real PUT /api/settings/system
      setSys(updated); setDraft(updated);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      setLoadErr('');
    } catch (e: any) { setLoadErr(e.message); }
  };

  const seedDemoTenant = async () => {
    setSeeding(true); setSeedMsg('');
    try {
      const res = await settingsApi.seedDemoTenant();
      setSeedMsg(`Tenant created — login: ${res.email ?? 'admin@damanecash.ma'} / Client#2026`);
      setOverview(await settingsApi.overview());
    } catch (e: any) { setSeedMsg(e.message); }
    finally { setSeeding(false); }
  };

  const isPartnerAdmin = user?.role === 'partner_admin';
  const tabs = [
    // Demo/trial account generator: platform + partner consoles only (never client admin).
    ...(isPlatformAdmin || isPartnerAdmin ? [{ id: 'demo-accounts', label: 'Demo Accounts', icon: UserPlus }] : []),
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'organization', label: 'Organization', icon: Building2 },
    { id: 'security', label: 'Security (2FA)', icon: Shield },
    ...(isPlatformAdmin ? [{ id: 'automation', label: 'Automation', icon: Zap }] : []),
    ...(isPlatformAdmin ? [{ id: 'platform', label: 'Platform', icon: Users }] : []),
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ];

  const dirty = !!draft && !!sys && JSON.stringify(draft) !== JSON.stringify(sys);

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)]">Settings</h1>
          <p className="text-[var(--ic-muted)] text-sm mt-1">All configuration is stored on the backend via the real Settings API — what you see here is exactly what the engine applies.</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-text)]"><RefreshCw size={15} /></button>
      </div>
      {loadErr && <p className="text-sm text-red-400 flex items-center gap-2"><ShieldAlert size={15} />{loadErr}</p>}

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-56 flex lg:flex-col gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === tab.id ? 'bg-cyan-500/10 text-cyan-400 border border-[var(--ic-border)]' : 'text-[var(--ic-muted)] hover:text-[var(--ic-heading)] hover:bg-[var(--ic-surface-2)]'
              }`}>
              <tab.icon className="w-4 h-4" />{tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-6">
          {activeTab === 'profile' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-[var(--ic-heading)]">Profile Settings</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--ic-muted)] mb-1.5 uppercase tracking-wider">Full Name</label>
                  <input type="text" defaultValue={user?.name} className="w-full px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] focus:outline-none focus:border-cyan-500/50" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ic-muted)] mb-1.5 uppercase tracking-wider">Email</label>
                  <input type="email" defaultValue={user?.email} className="w-full px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] focus:outline-none focus:border-cyan-500/50" />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'organization' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-[var(--ic-heading)]">Organization Settings</h3>
              {organization ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--ic-muted)] mb-1.5 uppercase tracking-wider">Organization Name</label>
                    <input type="text" defaultValue={organization.name} className="w-full px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] focus:outline-none focus:border-cyan-500/50" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--ic-muted)] mb-1.5 uppercase tracking-wider">Tier</label>
                    <div className="px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-cyan-400 uppercase font-medium">{(organization as any).tier ?? '—'}</div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[var(--ic-muted)]">You are signed in at platform level — manage tenants from the Platform tab.</p>
              )}
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-[var(--ic-heading)]">Security Configuration</h3>
              <div className="flex items-center justify-between p-4 rounded-lg bg-[var(--ic-surface)] border border-[var(--ic-border)]">
                <div className="flex items-center gap-3">
                  <Key className="w-5 h-5 text-cyan-400" />
                  <div>
                    <p className="text-sm font-medium text-[var(--ic-heading)]">Multi-Factor Authentication</p>
                    <p className="text-xs text-[var(--ic-muted)]">Currently: {user?.mfaEnabled ? 'Enabled' : 'Disabled'}</p>
                  </div>
                </div>
                {user?.mfaEnabled ? <ToggleRight className="w-8 h-8 text-emerald-400" /> : <ToggleLeft className="w-8 h-8 text-[var(--ic-muted)]" />}
              </div>
            </div>
          )}

          {activeTab === 'automation' && isPlatformAdmin && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-[var(--ic-heading)]">Automation Engine</h3>
              <p className="text-xs text-[var(--ic-muted)]">These toggles drive the real backend workers (SLA escalation loop, alert→ticket pipeline). Saved through <code className="text-cyan-400">PUT /api/settings/system</code>.</p>
              {!draft ? <p className="text-sm text-[var(--ic-muted)] flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Loading settings from backend…</p> : (
                <div className="space-y-3">
                  {toggleDefs.map(t => (
                    <div key={t.key} className="flex items-center justify-between p-4 rounded-lg bg-[var(--ic-surface)] border border-[var(--ic-border)] gap-4">
                      <div>
                        <p className="text-sm font-medium text-[var(--ic-heading)]">{t.label}</p>
                        <p className="text-xs text-[var(--ic-muted)] mt-0.5">{t.hint}</p>
                      </div>
                      <button onClick={() => setDraft({ ...draft, [t.key]: !draft[t.key] as any })} aria-label={t.label}>
                        {draft[t.key] ? <ToggleRight className="w-8 h-8 text-emerald-400 cursor-pointer" /> : <ToggleLeft className="w-8 h-8 text-[var(--ic-muted)] cursor-pointer" />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'demo-accounts' && (
            <div className="space-y-6">
              {!isPlatformAdmin ? (
              <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-8 text-center space-y-3">
                <ShieldAlert className="w-8 h-8 text-amber-400 mx-auto" />
                <h3 className="text-lg font-semibold text-[var(--ic-heading)]">Restricted area — Platform Admins only</h3>
                <p className="text-sm text-[var(--ic-muted)] max-w-md mx-auto">
                  The demo/trial account generator creates real accounts in the production database.
                  It is guarded and available exclusively to Infracentra platform administrators.
                </p>
                <button onClick={() => setActiveTab('profile')}
                  className="px-4 py-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-heading)] text-sm border border-[var(--ic-border)]">
                  Back to my settings
                </button>
              </div>
              ) : (
              <>
              <h3 className="text-lg font-semibold text-[var(--ic-heading)]">Demo / Trial Accounts for Real Users</h3>
              <p className="text-xs text-[var(--ic-muted)]">
                Creates a <span className="text-cyan-400">real account in our database</span> (organization + client admin)
                for an external evaluator, with the services you select and an automatic{' '}
                <span className="text-cyan-400">{daForm.trial_days}-day trial</span>. This is NOT the simulated demo mode —
                it provisions genuine entitlements through <code className="text-cyan-400">POST /api/settings/seed-demo-tenant</code>.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--ic-muted)] mb-1.5 uppercase tracking-wider">Real user email *</label>
                  <input type="email" value={daForm.email} onChange={e => setDaForm({ ...daForm, email: e.target.value })}
                    placeholder="evaluator@customer.com"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] focus:outline-none focus:border-cyan-500/50" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ic-muted)] mb-1.5 uppercase tracking-wider">Company / Org name *</label>
                  <input type="text" value={daForm.org_name} onChange={e => setDaForm({ ...daForm, org_name: e.target.value })}
                    placeholder="Customer SAS (Trial)"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] focus:outline-none focus:border-cyan-500/50" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ic-muted)] mb-1.5 uppercase tracking-wider">Initial password</label>
                  <input type="text" value={daForm.password} onChange={e => setDaForm({ ...daForm, password: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] focus:outline-none focus:border-cyan-500/50" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--ic-muted)] mb-1.5 uppercase tracking-wider">Trial duration (days)</label>
                  <input type="number" min={1} max={365} value={daForm.trial_days}
                    onChange={e => setDaForm({ ...daForm, trial_days: Number(e.target.value) || 30 })}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] focus:outline-none focus:border-cyan-500/50" />
                  <p className="text-[10px] text-[var(--ic-muted)] mt-1">Entitlements are stamped with an expiry date; default 30 days.</p>
                </div>
                <div className="flex flex-col justify-end gap-2 pb-1">
                  <label className="flex items-center gap-2 text-sm text-[var(--ic-text)] cursor-pointer">
                    <input type="checkbox" checked={daAllServices} onChange={e => setDaAllServices(e.target.checked)} className="accent-cyan-500" />
                    All 16 platform services
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[var(--ic-text)] cursor-pointer">
                    <input type="checkbox" checked={daIncludeTicketing} onChange={e => setDaIncludeTicketing(e.target.checked)} className="accent-cyan-500" />
                    Advanced Ticketing (Pro &amp; Enterprise feature)
                  </label>
                </div>
              </div>

              {!daAllServices && (
                <div>
                  <p className="text-xs font-medium text-[var(--ic-muted)] mb-2 uppercase tracking-wider">Pick services individually</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {serviceCatalog.map(s => {
                      const on = daSelected.includes(s.id);
                      return (
                        <button key={s.id} type="button"
                          onClick={() => setDaSelected(on ? daSelected.filter(x => x !== s.id) : [...daSelected, s.id])}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-xs transition-all ${
                            on ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300' : 'bg-[var(--ic-surface)] border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-[var(--ic-heading)]'}`}>
                          <span>{s.icon}</span>
                          <span className="truncate">{s.name}</span>
                          {on && <CheckCircle2 className="w-3.5 h-3.5 ml-auto flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {daError && <p className="text-sm text-red-400 flex items-center gap-2"><ShieldAlert size={15} />{daError}</p>}
              {daResult && <p className="text-sm text-emerald-400 flex items-start gap-2"><CheckCircle2 size={15} className="mt-0.5" />{daResult}</p>}

              <div className="pt-2">
                <button onClick={createDemoAccount}
                  disabled={daCreating || !daForm.email.includes('@') || !daForm.org_name.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-[var(--ic-heading)] text-sm font-medium hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed">
                  <UserPlus className="w-4 h-4" />{daCreating ? 'Creating in database…' : 'Create demo/trial account'}
                </button>
              </div>
              </>
              )}
            </div>
          )}

          {activeTab === 'platform' && isPlatformAdmin && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-[var(--ic-heading)]">Platform Overview</h3>
              {!overview ? <p className="text-sm text-[var(--ic-muted)] flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Loading from /api/settings/overview…</p> : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: 'Tenants', value: overview.tenants.length, icon: Building2 },
                      { label: 'Users', value: overview.user_count, icon: Users },
                      { label: 'Notification Rules', value: overview.rule_count, icon: Bell },
                      { label: 'Global Rules', value: overview.global_rule_count, icon: ScrollText },
                    ].map(c => (
                      <div key={c.label} className="p-4 rounded-lg bg-[var(--ic-surface)] border border-[var(--ic-border)]">
                        <c.icon className="w-4 h-4 text-cyan-400 mb-2" />
                        <p className="text-2xl font-bold text-[var(--ic-heading)]">{c.value}</p>
                        <p className="text-xs text-[var(--ic-muted)]">{c.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-[var(--ic-border)] overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--ic-surface-2)] text-[var(--ic-muted)] text-xs uppercase">
                        <tr><th className="text-left px-4 py-2">Tenant</th><th className="text-left px-4 py-2">Tier</th><th className="text-left px-4 py-2">Status</th></tr>
                      </thead>
                      <tbody>
                        {overview.tenants.map(o => (
                          <tr key={o.id} className="border-t border-[var(--ic-border)]">
                            <td className="px-4 py-2 text-[var(--ic-heading)]">{o.name}</td>
                            <td className="px-4 py-2 text-cyan-400 uppercase text-xs">{o.tier}</td>
                            <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] uppercase ${o.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-[var(--ic-surface-2)] text-[var(--ic-muted)]'}`}>{o.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-[var(--ic-muted)]">Delivery mode: <span className="text-cyan-400">{overview.delivery_mode}</span> (set DELIVERY_MODE=real in the backend container to dispatch through live SMTP/SMS/webhook connectors).</p>
                </>
              )}
              <div className="pt-4 border-t border-[var(--ic-border)] flex items-center gap-3">
                <button onClick={seedDemoTenant} disabled={seeding}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-heading)] text-sm border border-[var(--ic-border)] disabled:opacity-50">
                  <Play className="w-4 h-4" />{seeding ? 'Seeding…' : 'Seed demo tenant'}
                </button>
                <span className="text-xs text-[var(--ic-muted)]">Creates tenant “Damanecash” + client admin (admin@damanecash.ma / Client#2026) with default auto-ticketing rules.</span>
              </div>
              {seedMsg && <p className="text-sm text-cyan-400">{seedMsg}</p>}
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-[var(--ic-heading)]">Notification Channels & Delivery</h3>
              <p className="text-xs text-[var(--ic-muted)]">Routing rules, quiet hours per rule and delivery diagnostics live in the Notification Engine page. Here you configure the global channels.</p>
              {!draft ? <p className="text-sm text-[var(--ic-muted)]">Loading…</p> : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {([['email_enabled', 'Email'], ['sms_enabled', 'SMS'], ['webhook_enabled', 'Webhook']] as const).map(([k, label]) => (
                      <button key={k} onClick={() => setDraft({ ...draft, [k]: !draft[k] })}
                        className={`p-4 rounded-lg border text-left transition-all ${draft[k] ? 'bg-emerald-500/5 border-emerald-500/30 text-emerald-400' : 'bg-[var(--ic-surface)] border-[var(--ic-border)] text-[var(--ic-muted)]'}`}>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs mt-1">{draft[k] ? 'Channel enabled' : 'Channel disabled'}</p>
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <div>
                      <label className="block text-xs font-medium text-[var(--ic-muted)] mb-1.5 uppercase tracking-wider">Escalation contact email</label>
                      <input type="email" value={draft.escalation_email} onChange={e => setDraft({ ...draft, escalation_email: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] focus:outline-none focus:border-cyan-500/50" placeholder="oncall@yourcompany.com" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--ic-muted)] mb-1.5 uppercase tracking-wider">Outbound webhook URL</label>
                      <input type="url" value={draft.webhook_url} onChange={e => setDraft({ ...draft, webhook_url: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] focus:outline-none focus:border-cyan-500/50" placeholder="https://hooks…/events" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-[var(--ic-border)] flex items-center justify-end gap-3">
            {saved && <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="w-3.5 h-3.5" /> Saved to backend</span>}
            <button onClick={handleSave} disabled={!dirty}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-[var(--ic-heading)] text-sm font-medium hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed">
              <Save className="w-4 h-4" />Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
