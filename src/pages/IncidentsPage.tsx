import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Clock, User, Server, CheckCircle2, Shield, Zap, ArrowRight,
  RefreshCw, Search, X, ChevronLeft, ChevronRight, Plus, StickyNote, History,
  Link2, FileText, Inbox, Loader2, Hash,
} from 'lucide-react';
import ServiceGate from '../components/ServiceGate';
import OutcomeLabelPanel from '../components/OutcomeLabelPanel';
import { isDemoMode } from '../services/demoMode';
import { useAuth } from '../context/AuthContext';
import { organizationsApi, BackendOrganization } from '../services/api';
import {
  incidentsApi, INCIDENT_SEVERITIES, INCIDENT_STATUSES, ALLOWED_TRANSITIONS,
  IncidentRow, IncidentDetail, IncidentStatus, IncidentSeverity,
} from '../services/incidentsApi';

// ---------------------------------------------------------------------------
// Design-system tokens (same palette as the previous page)
// ---------------------------------------------------------------------------
const severityConfig: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
  high: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20' },
  medium: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20' },
  low: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  info: { bg: 'bg-slate-500/10', text: 'text-[var(--ic-muted)]', border: 'border-slate-500/20' },
};

const statusConfig: Record<string, { icon: any; color: string; label: string }> = {
  open: { icon: AlertTriangle, color: 'text-red-400', label: 'Open' },
  investigating: { icon: Clock, color: 'text-yellow-400', label: 'Investigating' },
  contained: { icon: Shield, color: 'text-cyan-400', label: 'Contained' },
  resolved: { icon: CheckCircle2, color: 'text-green-400', label: 'Resolved' },
  closed: { icon: CheckCircle2, color: 'text-[var(--ic-muted)]', label: 'Closed' },
};

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

function Badge({ className = '', title, children }: { className?: string; title?: string; children: React.ReactNode }) {
  return <span title={title} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border border-transparent ${className}`}>{children}</span>;
}

/** Distinguish CURRENT status from HISTORICAL activity colouring. */
const activityColor: Record<string, string> = {
  created: 'text-cyan-400', status_changed: 'text-yellow-400', assigned: 'text-blue-400',
  acked: 'text-emerald-400', note_added: 'text-[var(--ic-text)]', updated: 'text-[var(--ic-muted)]',
  evidence_added: 'text-purple-400', action_recorded: 'text-orange-400', ticket_linked: 'text-blue-300',
  ticket_created: 'text-blue-300', alert_linked: 'text-cyan-300', playbook_run: 'text-fuchsia-400',
};

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="block text-[11px] uppercase tracking-wider text-[var(--ic-muted)] mb-1">{label}</span>
    {children}
  </label>
);

const inputCls = 'w-full bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)] placeholder:text-[var(--ic-muted)] focus:outline-none focus:border-cyan-500/50';

interface Toast { kind: 'ok' | 'err'; msg: string }

// ---------------------------------------------------------------------------
// New-incident modal — POST /api/incidents (dedup-aware: backend may UPDATE an
// existing record and answer {reused:true} instead of creating a duplicate).
// ---------------------------------------------------------------------------
const NewIncidentModal: React.FC<{
  orgs: BackendOrganization[]; isAdmin: boolean; onClose: () => void;
  onCreated: (r: { reused: boolean; incident: IncidentRow }) => void;
  onError: (msg: string) => void;
}> = ({ orgs, isAdmin, onClose, onCreated, onError }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('medium');
  const [category, setCategory] = useState('');
  const [siteOrgId, setSiteOrgId] = useState<string>('');
  const [assets, setAssets] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) { onError('Title is required'); return; }
    setSaving(true);
    try {
      const r = await incidentsApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        severity,
        category: category.trim() || undefined,
        site_org_id: siteOrgId ? Number(siteOrgId) : undefined,
        affected_assets: assets.split(',').map(s => s.trim()).filter(Boolean),
      });
      onCreated(r);
    } catch (e: any) {
      onError(e?.message ?? 'Failed to open incident');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-[var(--ic-heading)]">Open a new incident</h3>
          <button onClick={onClose} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)]"><X size={18} /></button>
        </div>
        <Field label="Title *"><input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Suspicious login from untrusted geo" /></Field>
        <Field label="Description"><textarea className={inputCls} rows={3} value={description} onChange={e => setDescription(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Severity">
            <select className={inputCls} value={severity} onChange={e => setSeverity(e.target.value as IncidentSeverity)}>
              {INCIDENT_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Category"><input className={inputCls} value={category} onChange={e => setCategory(e.target.value)} placeholder="malware / phishing / …" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={isAdmin ? 'Organization / site (tenant scope)' : 'Site'}>
            {isAdmin ? (
              <select className={inputCls} value={siteOrgId} onChange={e => setSiteOrgId(e.target.value)}>
                <option value="">Default (my organization)</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}{o.org_type ? ` (${o.org_type})` : ''}</option>)}
              </select>
            ) : (
              <p className="text-xs text-[var(--ic-muted)] pt-2">Scoped automatically to your organization.</p>
            )}
          </Field>
          <Field label="Affected assets (comma-separated)"><input className={inputCls} value={assets} onChange={e => setAssets(e.target.value)} placeholder="fw-core-01, 10.0.0.5" /></Field>
        </div>
        <p className="text-[11px] text-[var(--ic-muted)]">If an open incident already matches this one, the backend updates the existing record instead of creating a duplicate (the banner in the list will say so).</p>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-[var(--ic-border)] text-[var(--ic-text)] hover:bg-[var(--ic-surface-2)]">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-4 py-2 rounded-lg text-sm bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />} Open incident
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Detail drawer — GET /api/incidents/{uid}: relationships (alert, ticket,
// org/site links), notes, activity trail, evidence, actions, playbook runs,
// and lifecycle buttons restricted to ALLOWED_TRANSITIONS (mirrors backend).
// ---------------------------------------------------------------------------
const DetailDrawer: React.FC<{
  uid: string; onClose: () => void; onChanged: () => void;
  pushToast: (t: Toast) => void; canManage: boolean;
}> = ({ uid, onClose, onChanged, pushToast, canManage }) => {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [tab, setTab] = useState<'overview' | 'notes' | 'activity'>('overview');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setDetail(await incidentsApi.get(uid)); }
    catch (e: any) { setError(e?.message ?? 'Failed to load incident'); }
    finally { setLoading(false); }
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(key);
    try { await fn(); pushToast({ kind: 'ok', msg: okMsg }); await load(); onChanged(); }
    catch (e: any) { pushToast({ kind: 'err', msg: e?.message ?? 'Action failed' }); await load(); }
    finally { setBusy(null); }
  };

  const sev = detail ? (severityConfig[detail.severity] ?? severityConfig.info) : null;
  const st = detail ? (statusConfig[detail.status] ?? statusConfig.open) : null;
  const StatusIcon = st?.icon ?? AlertTriangle;

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex justify-end" onClick={onClose}>
      <aside className="w-full max-w-2xl h-full bg-[var(--ic-surface)] border-l border-[var(--ic-border)] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-[var(--ic-surface)] border-b border-[var(--ic-border)] px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-cyan-300">{detail?.uid ?? uid}</span>
              {detail && <Badge className={`${sev!.bg} ${sev!.text} border ${sev!.border}`}>{detail.severity}</Badge>}
              {detail && (
                <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${st!.color} bg-[var(--ic-surface-2)]`}>
                  <StatusIcon className="w-3 h-3" />{st!.label}
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-[var(--ic-heading)] mt-1">{detail?.title ?? 'Loading…'}</h2>
          </div>
          <button onClick={onClose} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)] p-1"><X size={20} /></button>
        </div>

        {loading && (
          <div className="p-10 flex items-center gap-3 text-[var(--ic-muted)] justify-center"><Loader2 className="animate-spin" size={20} /> Loading incident from the backend…</div>
        )}
        {error && !loading && (
          <div className="m-5 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" /><div className="flex-1">{error}
              <button onClick={load} className="block mt-2 text-xs underline">Retry</button></div>
          </div>
        )}

        {detail && !loading && !error && (
          <div className="p-5 space-y-5">
            {/* Lifecycle buttons — only legal transitions offered (backend re-validates) */}
            {canManage && (
              <div className="flex items-center gap-2 flex-wrap">
                {(ALLOWED_TRANSITIONS[detail.status] ?? []).map(next => {
                  const cfg = statusConfig[next]; const Icon = cfg.icon;
                  return (
                    <button key={next} disabled={busy !== null}
                      onClick={() => run(`status:${next}`, () => incidentsApi.changeStatus(detail.uid, next), `Status moved to ${cfg.label}`)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--ic-border)] bg-[var(--ic-surface-2)] hover:bg-[var(--ic-border)] disabled:opacity-50 ${cfg.color}`}>
                      {busy === `status:${next}` ? <Loader2 size={13} className="animate-spin" /> : <Icon className="w-3.5 h-3.5" />} → {cfg.label}
                    </button>
                  );
                })}
                {!detail.acknowledged_by && (
                  <button disabled={busy !== null}
                    onClick={() => run('ack', () => incidentsApi.acknowledge(detail.uid), 'Incident acknowledged')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 disabled:opacity-50">
                    {busy === 'ack' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Acknowledge
                  </button>
                )}
                <button disabled={busy !== null}
                  onClick={() => {
                    const who = window.prompt('Assign owner (email):', detail.assignee ?? '') ;
                    if (who !== null) run('assign', () => incidentsApi.assign(detail.uid, who.trim()), 'Ownership updated');
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-blue-500/20 bg-blue-500/10 text-blue-400 disabled:opacity-50">
                  {busy === 'assign' ? <Loader2 size={13} className="animate-spin" /> : <User className="w-3.5 h-3.5" />} Assign
                </button>
                <button disabled={busy !== null}
                  onClick={() => run('ticket', () => incidentsApi.createTicket(detail.uid), 'Ticket ensured for incident')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--ic-border)] bg-[var(--ic-surface-2)] text-[var(--ic-text)] disabled:opacity-50">
                  {busy === 'ticket' ? <Loader2 size={13} className="animate-spin" /> : <FileText className="w-3.5 h-3.5" />} {detail.ticket ? 'Ensure ticket' : 'Create ticket'}
                </button>
                <button disabled={busy !== null}
                  onClick={() => navigate(`/client-admin/soar?playbook&incident=${encodeURIComponent(detail.uid)}`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-400 disabled:opacity-50">
                  <Zap className="w-3.5 h-3.5" /> Run playbook (SOAR)
                </button>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 border-b border-[var(--ic-border)]">
              {(['overview', 'notes', 'activity'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-3 py-2 text-xs font-semibold capitalize border-b-2 -mb-px ${tab === t ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-[var(--ic-muted)] hover:text-[var(--ic-heading)]'}`}>
                  {t === 'activity' ? 'Activity & audit trail' : t}
                  {t === 'notes' && ` (${detail.notes.length})`}
                  {t === 'activity' && ` (${detail.activity.length})`}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <div className="space-y-5">
                {detail.description && <p className="text-sm text-[var(--ic-text)] whitespace-pre-wrap">{detail.description}</p>}

                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div><span className="text-[var(--ic-muted)]">Reporter:</span> <span className="text-[var(--ic-heading)]">{detail.reporter ?? '—'}</span></div>
                  <div><span className="text-[var(--ic-muted)]">Assignee:</span> <span className="text-[var(--ic-heading)]">{detail.assignee ?? 'Unassigned'}</span></div>
                  <div><span className="text-[var(--ic-muted)]">Opened:</span> <span className="text-[var(--ic-heading)]">{fmt(detail.created_at)}</span></div>
                  <div><span className="text-[var(--ic-muted)]">Last update:</span> <span className="text-[var(--ic-heading)]">{fmt(detail.updated_at)}</span></div>
                  <div><span className="text-[var(--ic-muted)]">Acknowledged:</span> <span className="text-[var(--ic-heading)]">{detail.acknowledged_by ? `${detail.acknowledged_by} · ${fmt(detail.acknowledged_at)}` : 'not yet'}</span></div>
                  <div><span className="text-[var(--ic-muted)]">Resolved / Closed:</span> <span className="text-[var(--ic-heading)]">{fmt(detail.resolved_at)}{detail.closed_at ? ` / ${fmt(detail.closed_at)}` : ''}</span></div>
                  {detail.category && <div><span className="text-[var(--ic-muted)]">Category:</span> <span className="text-[var(--ic-heading)]">{detail.category}</span></div>}
                  {detail.tags?.length ? <div><span className="text-[var(--ic-muted)]">Tags:</span> <span className="text-[var(--ic-heading)]">{detail.tags.join(', ')}</span></div> : null}
                </div>

                {/* Relationships */}
                <section>
                  <h5 className="text-xs font-semibold text-[var(--ic-muted)] uppercase tracking-wider mb-2">Relationships</h5>
                  <div className="space-y-2 text-sm">
                    {detail.alert ? (
                      <button onClick={() => navigate('/threats')} className="w-full text-left flex items-center gap-2 p-2.5 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] hover:border-cyan-500/40">
                        <AlertTriangle size={14} className="text-red-400" />
                        <span className="font-mono text-xs text-cyan-300">{detail.alert.uid}</span>
                        <span className="text-[var(--ic-text)] truncate">{detail.alert.resource || detail.alert.source}</span>
                        <span className="ml-auto text-[10px] text-[var(--ic-muted)]">{detail.alert.correlated_count ?? 1} correlated · opens SIEM view</span>
                      </button>
                    ) : <p className="text-xs text-[var(--ic-muted)]">No SIEM alert linked to this incident.</p>}

                    {detail.ticket ? (
                      <button onClick={() => navigate('/advanced-ticketing')} className="w-full text-left flex items-center gap-2 p-2.5 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] hover:border-cyan-500/40">
                        <FileText size={14} className="text-blue-400" />
                        <span className="font-mono text-xs text-cyan-300">{detail.ticket.uid}</span>
                        <Badge className="bg-blue-500/20 text-blue-300">{detail.ticket.priority}</Badge>
                        <span className="ml-auto text-[10px] text-[var(--ic-muted)]">{detail.ticket.status} · opens ticketing</span>
                      </button>
                    ) : <p className="text-xs text-[var(--ic-muted)]">No ticket linked yet — use “Create ticket” above.</p>}

                    {(detail.organization || detail.site) && (
                      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm">
                        <BuildingIcon />
                        {detail.organization && (
                          <button onClick={() => navigate(`/platform/organizations/${detail.organization!.id}`)} className="text-cyan-300 hover:underline">{detail.organization.name}</button>
                        )}
                        {detail.site && (
                          <>
                            <span className="text-[var(--ic-muted)] text-xs">/ site:</span>
                            <button onClick={() => navigate(`/platform/organizations/${detail.site!.id}`)} className="text-cyan-300 hover:underline">{detail.site.name}</button>
                            {detail.site.org_type && <Badge className="bg-slate-600/40 text-[var(--ic-text)]">{detail.site.org_type}</Badge>}
                          </>
                        )}
                        <span className="ml-auto text-[10px] text-[var(--ic-muted)]">opens org details</span>
                      </div>
                    )}
                  </div>
                </section>

                {/* Affected assets -> device/discovery link */}
                <section>
                  <h5 className="text-xs font-semibold text-[var(--ic-muted)] uppercase tracking-wider mb-2">Affected assets</h5>
                  {detail.affected_assets?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {detail.affected_assets.map(a => (
                        <button key={a} onClick={() => navigate('/client-admin/devices')} title="Open device inventory"
                          className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-xs font-mono text-[var(--ic-heading)] hover:border-cyan-500/40">
                          <Server size={11} className="text-[var(--ic-muted)]" />{a}
                        </button>
                      ))}
                    </div>
                  ) : <p className="text-xs text-[var(--ic-muted)]">No assets recorded.</p>}
                  {detail.ioc_related?.length ? (
                    <p className="text-xs text-[var(--ic-muted)] mt-2">IOCs: <span className="font-mono text-purple-300">{detail.ioc_related.join(', ')}</span></p>
                  ) : null}
                </section>

                {/* Evidence + response actions */}
                <section className="grid grid-cols-2 gap-4">
                  <div>
                    <h5 className="text-xs font-semibold text-[var(--ic-muted)] uppercase tracking-wider mb-2">Evidence ({detail.evidence.length})</h5>
                    {detail.evidence.length ? (
                      <ul className="space-y-1 text-xs">
                        {detail.evidence.map(e => (
                          <li key={e.id} className="flex items-center gap-2 text-[var(--ic-text)]">
                            <FileText size={12} className="text-[var(--ic-muted)] shrink-0" />
                            <span className="truncate">{e.name}</span>
                            <Badge className="bg-slate-600/40 text-[var(--ic-muted)]">{e.kind}</Badge>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-xs text-[var(--ic-muted)]">None attached.</p>}
                    {canManage && (
                      <button disabled={busy !== null}
                        onClick={() => {
                          const name = window.prompt('Evidence artifact name (record only — collection happens via connectors):');
                          if (name) run('ev', () => incidentsApi.addEvidence(detail.uid, name), 'Evidence entry recorded');
                        }}
                        className="mt-2 text-xs text-cyan-400 hover:underline flex items-center gap-1"><Plus size={12} /> Attach evidence reference</button>
                    )}
                  </div>
                  <div>
                    <h5 className="text-xs font-semibold text-[var(--ic-muted)] uppercase tracking-wider mb-2">Response actions ({detail.actions.length})</h5>
                    {detail.actions.length ? (
                      <ul className="space-y-1 text-xs">
                        {detail.actions.map(a => (
                          <li key={a.id} className="flex items-center gap-2 text-[var(--ic-text)]">
                            <ArrowRight size={12} className={a.status === 'completed' ? 'text-green-400' : a.status === 'failed' ? 'text-red-400' : 'text-yellow-400'} />
                            <span className="truncate">{a.action_type}</span>
                            {a.playbook_run_uid && <span className="font-mono text-[10px] text-fuchsia-400">{a.playbook_run_uid}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-xs text-[var(--ic-muted)]">No actions recorded.</p>}
                    {canManage && (
                      <button disabled={busy !== null}
                        onClick={() => {
                          const t = window.prompt('Record a manual response action (ledger only — nothing is executed): e.g. "password_reset"');
                          if (t) run('act', () => incidentsApi.recordAction(detail.uid, t), 'Action recorded in ledger');
                        }}
                        className="mt-2 text-xs text-cyan-400 hover:underline flex items-center gap-1"><Plus size={12} /> Record action</button>
                    )}
                  </div>
                </section>

                {/* Playbook runs related to this incident */}
                {detail.playbook_runs.length > 0 && (
                  <section>
                    <h5 className="text-xs font-semibold text-[var(--ic-muted)] uppercase tracking-wider mb-2">Playbook runs</h5>
                    <div className="space-y-1">
                      {detail.playbook_runs.map(r => (
                        <div key={r.uid} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)]">
                          <Zap size={12} className="text-fuchsia-400" />
                          <span className="font-mono text-cyan-300">{r.uid}</span>
                          <Badge className="bg-slate-600/40 text-[var(--ic-muted)]">{r.mode}</Badge>
                          <RunStatusChip status={r.status} />
                          <span className="ml-auto text-[10px] text-[var(--ic-muted)]">{fmt(r.started_at)}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* STAGE 6A — structured outcome labeling (append-only, audited).
                    Talks to /api/triage/incidents/{uid}/outcome-label[s]; visible
                    in every role (client_user sees read-only state on 403). */}
                {!isDemoMode() && (
                  <OutcomeLabelPanel uid={detail.uid} status={detail.status} pushToast={pushToast} />
                )}
              </div>
            )}

            {tab === 'notes' && (
              <div className="space-y-3">
                {canManage && (
                  <div className="flex gap-2">
                    <input className={inputCls} placeholder="Add an investigation note…" value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && noteText.trim()) run('note', async () => { await incidentsApi.addNote(detail.uid, noteText.trim()); setNoteText(''); }, 'Note added'); }} />
                    <button disabled={busy !== null || !noteText.trim()}
                      onClick={() => run('note', async () => { await incidentsApi.addNote(detail.uid, noteText.trim()); setNoteText(''); }, 'Note added')}
                      className="px-4 py-2 rounded-lg text-sm bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-50 shrink-0">Add</button>
                  </div>
                )}
                {detail.notes.length ? (
                  <ul className="space-y-2">
                    {[...detail.notes].reverse().map(n => (
                      <li key={n.id} className="p-3 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)]">
                        <div className="flex items-center gap-2 text-[11px] text-[var(--ic-muted)] mb-1">
                          <StickyNote size={12} /><span className="text-[var(--ic-heading)] font-semibold">{n.author}</span>
                          <span>·</span><span>{fmt(n.created_at)}</span>
                          {!n.internal && <Badge className="bg-emerald-500/20 text-emerald-300" title="Client-visible note">external</Badge>}
                        </div>
                        <p className="text-sm text-[var(--ic-text)] whitespace-pre-wrap">{n.content}</p>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-xs text-[var(--ic-muted)]">No investigation notes yet.</p>}
              </div>
            )}

            {tab === 'activity' && (
              <div className="relative pl-6 space-y-4">
                <div className="absolute left-2 top-2 bottom-2 w-px bg-[var(--ic-surface-2)]" />
                {detail.activity.length ? [...detail.activity].reverse().map((a, idx) => (
                  <div key={a.id} className="relative">
                    <div className={`absolute -left-4 top-1.5 w-3 h-3 rounded-full border-2 ${idx === 0 ? 'border-cyan-400 bg-cyan-400/20' : 'border-[var(--ic-border)] bg-[var(--ic-surface)]'}`}
                      title={idx === 0 ? 'Most recent event' : 'Historical event'} />
                    <p className={`text-sm font-medium ${activityColor[a.action] ?? 'text-[var(--ic-heading)]'}`}>
                      <History size={11} className="inline mr-1 opacity-60" />{a.action.replace(/_/g, ' ')}
                      {a.from_value != null && a.to_value != null && (
                        <span className="text-[var(--ic-muted)] font-normal"> — {a.from_value || '∅'} → {a.to_value || '∅'}</span>
                      )}
                    </p>
                    {a.detail && <p className="text-xs text-[var(--ic-text)] mt-0.5">{a.detail}</p>}
                    <div className="flex items-center gap-2 mt-1 text-xs text-[var(--ic-muted)]">
                      <span>{fmt(a.created_at)}</span><span>•</span><span>{a.actor}</span>
                    </div>
                  </div>
                )) : <p className="text-xs text-[var(--ic-muted)]">Audit trail empty.</p>}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
};

const BuildingIcon = () => <Server size={14} className="text-[var(--ic-muted)]" />;

export const RunStatusChip: React.FC<{ status: string }> = ({ status }) => {
  const map: Record<string, string> = {
    completed: 'bg-green-500/20 text-green-400', failed: 'bg-red-500/20 text-red-400',
    partial: 'bg-orange-500/20 text-orange-400', cancelled: 'bg-slate-600/40 text-[var(--ic-muted)]',
    running: 'bg-cyan-500/20 text-cyan-300 animate-pulse', queued: 'bg-slate-600/40 text-[var(--ic-muted)]',
  };
  return <Badge className={map[status] ?? map.queued}>{status}</Badge>;
};

// ---------------------------------------------------------------------------
// Main content — production mode consumes /api/incidents exclusively (search,
// filters, sorting, pagination). Demo Mode uses the mirrored in-memory engine.
// No mock fallback is ever rendered as "live".
// ---------------------------------------------------------------------------
function IncidentsContent() {
  const { user } = useAuth();
  const role = user?.role ?? 'client_user';
  const canManage = ['platform_admin', 'client_admin'].includes(role);

  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [sort, setSort] = useState<'created_at' | 'updated_at' | 'severity' | 'status' | 'title'>('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [qInput, setQInput] = useState(() => {
    // Deep links from Analytics / Threat Intel (?q=<asset>) pre-fill the search.
    try { return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('q') ?? ''; } catch { return ''; }
  });
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState<IncidentStatus | ''>('');
  const [fSeverity, setFSeverity] = useState<IncidentSeverity | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [orgs, setOrgs] = useState<BackendOrganization[]>([]);

  const pushToast = useCallback((t: Toast) => { setToast(t); setTimeout(() => setToast(null), 4500); }, []);

  // Debounced search box
  useEffect(() => { const id = setTimeout(() => { setQ(qInput); setPage(1); }, 350); return () => clearTimeout(id); }, [qInput]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await incidentsApi.list({ q: q || undefined, status: fStatus, severity: fSeverity, sort, order, page, page_size: pageSize });
      setRows(r.items); setTotal(r.total); setStatusCounts(r.status_counts ?? {});
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load incidents'); setRows([]); setTotal(0);
    } finally { setLoading(false); }
  }, [q, fStatus, fSeverity, sort, order, page, pageSize]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (role === 'platform_admin') organizationsApi.list().then(setOrgs).catch(() => setOrgs([]));
  }, [role]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const partial = !loading && !error && rows.length < total;

  const headerCounts = useMemo(() => INCIDENT_STATUSES.map(s => ({ s, n: statusCounts[s] ?? 0 })), [statusCounts]);

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)]">Incident Response</h1>
          <p className="text-[var(--ic-muted)] text-sm mt-1">Live incident tracking backed by the FastAPI incident engine ({isDemoMode() ? 'Demo Mode — simulated backend' : 'production data'})</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} title="Re-pull from the backend"
            className="flex items-center gap-2 text-xs text-[var(--ic-muted)] hover:text-[var(--ic-heading)] border border-[var(--ic-border)] rounded-lg px-3 py-2">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          {canManage && (
            <button onClick={() => setShowNew(true)}
              className="flex items-center gap-2 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg px-3 py-2">
              <Plus size={14} /> New incident
            </button>
          )}
        </div>
      </div>

      {/* Search + filters + sort */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ic-muted)]" />
          <input value={qInput} onChange={e => setQInput(e.target.value)} placeholder="Search title, description, UID, asset…"
            className="w-full bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg pl-9 pr-8 py-2 text-sm text-[var(--ic-heading)] placeholder:text-[var(--ic-muted)] focus:outline-none focus:border-cyan-500/50" />
          {qInput && <button onClick={() => setQInput('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ic-muted)] hover:text-[var(--ic-heading)]"><X size={14} /></button>}
        </div>
        <select value={fStatus} onChange={e => { setFStatus(e.target.value as any); setPage(1); }}
          className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]">
          <option value="">All statuses</option>
          {INCIDENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fSeverity} onChange={e => { setFSeverity(e.target.value as any); setPage(1); }}
          className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]">
          <option value="">All severities</option>
          {INCIDENT_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={`${sort}:${order}`} onChange={e => { const [s, o] = e.target.value.split(':'); setSort(s as any); setOrder(o as any); }}
          className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]">
          <option value="created_at:desc">Newest first</option>
          <option value="created_at:asc">Oldest first</option>
          <option value="updated_at:desc">Recently updated</option>
          <option value="severity:desc">Severity ↓</option>
          <option value="severity:asc">Severity ↑</option>
          <option value="status:asc">Status</option>
          <option value="title:asc">Title A–Z</option>
        </select>
        <span className="text-xs text-[var(--ic-muted)] ml-auto">{total} incident{total === 1 ? '' : 's'}</span>
      </div>

      {/* Status counters */}
      <div className="flex flex-wrap gap-2">
        {headerCounts.map(({ s, n }) => {
          const cfg = statusConfig[s]; const Icon = cfg.icon;
          return (
            <button key={s} onClick={() => { setFStatus(fStatus === s ? '' : s); setPage(1); }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border transition ${fStatus === s ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300' : 'border-[var(--ic-border)] bg-[var(--ic-surface)] text-[var(--ic-muted)] hover:text-[var(--ic-heading)]'}`}>
              <Icon size={11} className={cfg.color} /> {cfg.label} <b className="text-[var(--ic-heading)]">{n}</b>
            </button>
          );
        })}
      </div>

      {/* States: loading / error / empty / partial */}
      {loading && rows.length === 0 && (
        <div className="py-16 flex flex-col items-center gap-3 text-[var(--ic-muted)]">
          <Loader2 className="animate-spin text-cyan-400" size={28} />
          <p className="text-sm">Loading incidents…</p>
        </div>
      )}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-start gap-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div className="flex-1"><p className="font-semibold">Could not load incidents</p><p className="mt-1 text-xs opacity-90">{error}</p></div>
          <button onClick={load} className="text-xs underline shrink-0">Retry</button>
        </div>
      )}
      {!loading && !error && rows.length === 0 && (
        <div className="py-16 flex flex-col items-center gap-2 text-center">
          <Inbox className="text-[var(--ic-muted)]" size={32} />
          <p className="text-[var(--ic-heading)] text-sm font-semibold">No incidents match your filters</p>
          <p className="text-xs text-[var(--ic-muted)]">{q || fStatus || fSeverity ? 'Try clearing the search or filters.' : 'When alerts correlate into incidents they will appear here.'}</p>
          {(q || fStatus || fSeverity) && (
            <button onClick={() => { setQInput(''); setQ(''); setFStatus(''); setFSeverity(''); setPage(1); }}
              className="mt-2 text-xs text-cyan-400 hover:underline">Clear all filters</button>
          )}
        </div>
      )}
      {partial && (
        <p className="text-xs text-amber-400 flex items-center gap-1"><AlertTriangle size={12} /> Partial results — showing {rows.length} of {total} incidents for this page.</p>
      )}

      {/* List */}
      {rows.length > 0 && (
        <div className="space-y-3">
          {rows.map(incident => {
            const sev = severityConfig[incident.severity] ?? severityConfig.info;
            const st = statusConfig[incident.status] ?? statusConfig.open;
            const StatusIcon = st.icon;
            return (
              <button key={incident.uid} onClick={() => setSelected(incident.uid)}
                className={`w-full text-left bg-[var(--ic-surface)] border ${sev.border} rounded-xl p-4 hover:bg-[var(--ic-surface-2)] transition`}>
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${sev.bg} flex-shrink-0`}><AlertTriangle className={`w-5 h-5 ${sev.text}`} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[11px] text-cyan-300">{incident.uid}</span>
                      <h4 className="text-sm font-semibold text-[var(--ic-heading)] truncate max-w-[420px]">{incident.title}</h4>
                      <Badge className={`${sev.bg} ${sev.text} border ${sev.border} uppercase`}>{incident.severity}</Badge>
                      <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${st.color} bg-[var(--ic-surface-2)]`}>
                        <StatusIcon className="w-3 h-3" />{st.label}
                      </span>
                      {incident.acknowledged_by && <Badge className="bg-emerald-500/15 text-emerald-400" title={`Acknowledged ${fmt(incident.acknowledged_at)}`}>acked</Badge>}
                      {incident.ticket_uid && <Badge className="bg-blue-500/15 text-blue-300"><Link2 size={9} className="inline mr-0.5" />{incident.ticket_uid}</Badge>}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-[var(--ic-muted)] flex-wrap">
                      <span className="flex items-center gap-1"><User className="w-3 h-3" /> {incident.assignee ?? 'Unassigned'}</span>
                      <span className="flex items-center gap-1"><Server className="w-3 h-3" /> {incident.affected_assets?.length ?? 0} asset{(incident.affected_assets?.length ?? 0) === 1 ? '' : 's'}</span>
                      <span className="flex items-center gap-1"><Hash className="w-3 h-3" /> {incident.category ?? 'uncategorized'}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> opened {fmt(incident.created_at)}</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[var(--ic-muted)] shrink-0 mt-2" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-[var(--ic-muted)]">Page {page} of {totalPages} · {total} incidents</p>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
              className="p-2 rounded-lg border border-[var(--ic-border)] text-[var(--ic-text)] disabled:opacity-40 hover:bg-[var(--ic-surface-2)]"><ChevronLeft size={14} /></button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="p-2 rounded-lg border border-[var(--ic-border)] text-[var(--ic-text)] disabled:opacity-40 hover:bg-[var(--ic-surface-2)]"><ChevronRight size={14} /></button>
          </div>
        </div>
      )}

      {selected && (
        <DetailDrawer uid={selected} onClose={() => setSelected(null)} onChanged={load} pushToast={pushToast} canManage={canManage} />
      )}
      {showNew && (
        <NewIncidentModal orgs={orgs} isAdmin={role === 'platform_admin'}
          onClose={() => setShowNew(false)}
          onCreated={(r) => {
            setShowNew(false);
            pushToast({ kind: 'ok', msg: r.reused ? `Existing incident ${r.incident.uid} updated (no duplicate created)` : `Incident ${r.incident.uid} opened` });
            load(); setSelected(r.incident.uid);
          }}
          onError={(msg) => pushToast({ kind: 'err', msg })} />
      )}
      {toast && (
        <div className={`fixed bottom-5 right-5 z-[60] px-4 py-3 rounded-xl text-sm shadow-xl border max-w-md ${toast.kind === 'ok' ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-red-500/15 border-red-500/40 text-red-300'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

export default function IncidentsPage() {
  return <ServiceGate serviceId="incident-response"><IncidentsContent /></ServiceGate>;
}
