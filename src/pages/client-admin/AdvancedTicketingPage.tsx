import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Inbox, Plus, Search, RefreshCw, X, ShieldAlert, Clock, AlertOctagon,
  FileText, Lock, CheckCircle2, XCircle, Bot, GitBranch, Users, Play,
  Paperclip, MessageSquarePlus, Download,
} from 'lucide-react';

/** Read a browser File and return its base64 payload (no data: prefix). */
const readFileB64 = (file: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] ?? '');
  r.onerror = rej;
  r.readAsDataURL(file);
});

/** Guess evidence kind from filename/mime (image/pdf/config/log/txt). */
const guessKind = (name: string, mime: string): string => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'screenshot';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (['pcap', 'cap'].includes(ext)) return 'pcap';
  if (['yml', 'yaml', 'json', 'conf', 'cfg', 'ini', 'xml', 'toml', 'env'].includes(ext)) return 'config';
  if (['log', 'txt', 'md', 'csv'].includes(ext)) return 'log';
  return 'file';
};
import { useAuth } from '../../context/AuthContext';
import {
  ticketsApi, AdvTicket, TicketEvidence, AuditEntry, Approval, TenantRef,
  ApiError,
} from '../../services/api';

// ---------------------------------------------------------------------------
// Helpers / presentational atoms (all data comes from the real backend API)
// ---------------------------------------------------------------------------

const PRIORITIES = ['p1', 'p2', 'p3', 'p4'];
const CATEGORIES = ['incident', 'service_request', 'problem', 'change', 'vulnerability', 'other'];
const STATUSES = ['new', 'triage', 'open', 'pending', 'escalated', 'resolved', 'closed'];

const prioColor: Record<string, string> = {
  p1: 'bg-red-500/20 text-red-400 border-red-500/40',
  p2: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
  p3: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  p4: 'bg-sky-500/20 text-sky-400 border-sky-500/40',
};
const statusColor: Record<string, string> = {
  new: 'bg-slate-500/20 text-[var(--ic-text)]',
  triage: 'bg-purple-500/20 text-purple-300',
  open: 'bg-cyan-500/20 text-cyan-300',
  pending: 'bg-amber-500/20 text-amber-300',
  escalated: 'bg-red-500/20 text-red-300',
  resolved: 'bg-emerald-500/20 text-emerald-300',
  closed: 'bg-slate-600/30 text-[var(--ic-muted)]',
};
const slaColor: Record<string, string> = {
  breached: 'text-red-400', at_risk: 'text-orange-400', on_track: 'text-emerald-400', met: 'text-emerald-400', paused: 'text-[var(--ic-muted)]',
};

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const ago = (iso?: string | null) => {
  if (!iso) return '—';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

const Badge: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border border-transparent ${className}`}>{children}</span>
);

// ---------------------------------------------------------------------------
// Create-ticket modal — every parameter a client or ops team needs
// ---------------------------------------------------------------------------

interface FormState {
  title: string; description: string; priority: string; category: string;
  org_id: string; assignee: string; tags: string; asset: string; vulnerability_ref: string;
}
const emptyForm: FormState = {
  title: '', description: '', priority: 'p3', category: 'incident',
  org_id: '', assignee: '', tags: '', asset: '', vulnerability_ref: '',
};

const CreateTicketModal: React.FC<{
  tenants: TenantRef[]; isPlatform: boolean; onClose: () => void;
  onCreate: (data: Parameters<typeof ticketsApi.create>[0]) => Promise<AdvTicket | void>;
}> = ({ tenants, isPlatform, onClose, onCreate }) => {
  const [f, setF] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.title.trim().length < 3) { setErr('Title must be at least 3 characters.'); return; }
    setBusy(true); setErr('');
    try {
      const created = await onCreate({
        title: f.title.trim(),
        description: f.description.trim() || undefined,
        priority: f.priority,
        category: f.category,
        org_id: isPlatform && f.org_id ? Number(f.org_id) : undefined,
        assignee: f.assignee.trim() || undefined,
        tags: f.tags.split(',').map(t => t.trim()).filter(Boolean),
        asset: f.asset.trim() || undefined,
        vulnerability_ref: f.vulnerability_ref.trim() || undefined,
      });
      // Attach every staged file to the freshly created ticket (evidence vault).
      const uid = (created as any)?.uid;
      if (uid && attachments.length) {
        for (const file of attachments) {
          const b64 = await readFileB64(file);
          await ticketsApi.addEvidence(uid, {
            name: file.name, kind: guessKind(file.name, file.type), content: '',
            file_b64: b64, mime_type: file.type || 'application/octet-stream',
          });
        }
      }
      onClose();
    } catch (ex: any) { setErr(ex.message || 'Failed to create ticket'); }
    finally { setBusy(false); }
  };

  const inp = 'w-full bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)] focus:border-cyan-500 outline-none';
  const lbl = 'block text-xs font-semibold text-[var(--ic-muted)] mb-1 uppercase tracking-wide';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--ic-heading)] flex items-center gap-2"><Plus className="text-cyan-400" size={20} /> Create Ticket</h2>
          <button type="button" onClick={onClose} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)]"><X size={20} /></button>
        </div>
        <div>
          <label className={lbl}>Title *</label>
          <input className={inp} value={f.title} onChange={set('title')} placeholder="e.g. Ransomware signature detected on file server" autoFocus />
        </div>
        <div>
          <label className={lbl}>Description</label>
          <textarea className={inp} rows={3} value={f.description} onChange={set('description')}
            placeholder="Details, logs, impact… (feeds the AI classifier)" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className={lbl}>Priority</label>
            <select className={inp} value={f.priority} onChange={set('priority')}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Category</label>
            <select className={inp} value={f.category} onChange={set('category')}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
            </select>
          </div>
          {isPlatform && (
            <div>
              <label className={lbl}>Tenant</label>
              <select className={inp} value={f.org_id} onChange={set('org_id')}>
                <option value="">Select tenant…</option>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={lbl}>Assignee</label>
            <input className={inp} value={f.assignee} onChange={set('assignee')} placeholder="analyst email or name" />
          </div>
          <div>
            <label className={lbl}>Asset</label>
            <input className={inp} value={f.asset} onChange={set('asset')} placeholder="FW-EDGE-01 / 10.0.0.5" />
          </div>
          <div>
            <label className={lbl}>Vulnerability ref (CVE)</label>
            <input className={inp} value={f.vulnerability_ref} onChange={set('vulnerability_ref')} placeholder="CVE-2026-XXXXX" />
          </div>
        </div>
        <div>
          <label className={lbl}>Tags (comma separated)</label>
          <input className={inp} value={f.tags} onChange={set('tags')} placeholder="firewall, compliance, lateral-movement" />
        </div>

        {/* Attachments — files are uploaded to the ticket evidence vault on submit */}
        <div>
          <label className={lbl}>Attachments</label>
          <input ref={fileRef} type="file" multiple className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.txt,.md,.log,.csv,.json,.yml,.yaml,.conf,.cfg,.ini,.xml,.toml,.env,.pcap,.cap"
            onChange={e => { setAttachments(Array.from(e.target.files || [])); }} />
          <button type="button" onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg border border-dashed border-[var(--ic-border)] hover:border-cyan-500 text-[var(--ic-text)] text-sm bg-[var(--ic-surface)]">
            <Paperclip size={15} className="text-cyan-400" />
            Attach files — images, PDF, config files, logs, text…
          </button>
          {attachments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {attachments.map((a, i) => (
                <li key={i} className="flex items-center justify-between bg-[var(--ic-surface)] rounded-lg px-3 py-1.5 text-xs text-[var(--ic-text)]">
                  <span className="truncate flex items-center gap-2"><FileText size={12} className="text-cyan-400 shrink-0" />{a.name} · {(a.size / 1024).toFixed(1)} KB</span>
                  <button type="button" onClick={() => setAttachments(attachments.filter((_, j) => j !== i))}
                    className="text-[var(--ic-muted)] hover:text-red-400 ml-2"><X size={13} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {err && <p className="text-red-400 text-sm">{err}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-[var(--ic-text)] bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)]">Cancel</button>
          <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-[var(--ic-heading)]">
            {busy ? 'Creating…' : 'Create Ticket'}
          </button>
        </div>
        <p className="text-[11px] text-[var(--ic-muted)]">On submit the backend runs AI-assisted classification, duplicate correlation and starts SLA timers automatically.</p>
      </form>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Detail drawer: AI triage · SLA · audit chain · evidence vault · approvals
// ---------------------------------------------------------------------------

const DetailDrawer: React.FC<{
  ticket: AdvTicket; onClose: () => void; onChanged: () => void;
}> = ({ ticket, onClose, onChanged }) => {
  const { user } = useAuth();
  const [tab, setTab] = useState<'overview' | 'audit' | 'evidence' | 'approvals'>('overview');
  const [evidence, setEvidence] = useState<TicketEvidence[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [evName, setEvName] = useState(''); const [evKind, setEvKind] = useState('log'); const [evContent, setEvContent] = useState('');
  const [closureNote, setClosureNote] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const [e, a, aps] = await Promise.all([
        ticketsApi.evidence(ticket.uid),
        ticketsApi.audit(ticket.uid),
        ticketsApi.approvals(ticket.uid),
      ]);
      setEvidence(e); setAudit(a); setApprovals(aps);
    } catch (ex: any) { setErr(ex.message); }
  }, [ticket.uid]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setErr('');
    try { await fn(); await load(); onChanged(); }
    catch (ex: any) { setErr(ex.message); }
  };

  const patch = (data: Record<string, any>) => () => act(() => ticketsApi.update(ticket.uid, data));

  // Work-in-progress editing: description / assignee can be updated while the ticket is not resolved/closed.
  const editable = !['resolved', 'closed'].includes(ticket.status);
  const [editDesc, setEditDesc] = useState<string | null>(null); // null = not editing
  useEffect(() => { setEditDesc(null); }, [ticket.uid]);
  const [fileRef2] = useState(() => React.createRef<HTMLInputElement>());
  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErr('');
    try {
      for (const file of Array.from(files)) {
        const b64 = await readFileB64(file);
        await ticketsApi.addEvidence(ticket.uid, {
          name: file.name, kind: guessKind(file.name, file.type), content: '',
          file_b64: b64, mime_type: file.type || 'application/octet-stream',
        });
      }
      await load(); onChanged();
    } catch (ex: any) { setErr(ex.message || 'Upload failed'); }
  };

  const tabs = ['overview', 'audit', 'evidence', 'approvals'] as const;
  return (
    <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose}>
      <aside onClick={e => e.stopPropagation()}
        className="absolute right-0 top-0 h-full w-full max-w-xl bg-[var(--ic-surface)] border-l border-[var(--ic-border)] overflow-y-auto p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-[var(--ic-muted)] font-mono">{ticket.uid} · source: {ticket.source}{ticket.alert_id ? ` · alert #${ticket.alert_id}` : ''}</p>
            <h2 className="text-lg font-bold text-[var(--ic-heading)] leading-tight">{ticket.title}</h2>
            <div className="flex gap-2 mt-2 flex-wrap">
              <Badge className={prioColor[ticket.priority]}>{ticket.priority.toUpperCase()}</Badge>
              <Badge className={statusColor[ticket.status]}>{ticket.status}</Badge>
              {ticket.tags.map(t => <Badge key={t} className="bg-[var(--ic-surface-2)] text-[var(--ic-text)]">{t}</Badge>)}
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)]"><X /></button>
        </div>
        {err && <p className="text-red-400 text-sm">{err}</p>}

        <div className="flex gap-1 border-b border-[var(--ic-border)]">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm capitalize ${tab === t ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-[var(--ic-muted)] hover:text-[var(--ic-heading)]'}`}>{t}</button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="space-y-4">
            {/* Editable work-in-progress description (only while ticket is not resolved/closed) */}
            {editable ? (
              <div className="bg-[var(--ic-surface)] rounded-lg p-3 space-y-2">
                <p className="text-[11px] uppercase text-[var(--ic-muted)] tracking-wide flex items-center gap-1"><MessageSquarePlus size={12} /> Work notes / description</p>
                {editDesc === null ? (
                  <>
                    {ticket.description && <p className="text-sm text-[var(--ic-text)] whitespace-pre-wrap">{ticket.description}</p>}
                    {!ticket.description && <p className="text-sm text-[var(--ic-muted)] italic">No description yet.</p>}
                    <button onClick={() => setEditDesc(ticket.description || '')}
                      className="px-3 py-1.5 rounded bg-[var(--ic-surface-2)] hover:bg-slate-600 text-[var(--ic-heading)] text-xs font-semibold">✎ Edit / add text</button>
                  </>
                ) : (
                  <>
                    <textarea rows={4} value={editDesc} onChange={e => setEditDesc(e.target.value)}
                      className="w-full bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded px-2 py-1.5 text-sm text-[var(--ic-heading)]" placeholder="Add details, actions taken, findings…" />
                    <div className="flex gap-2">
                      <button onClick={() => act(async () => { await ticketsApi.update(ticket.uid, { description: editDesc }); setEditDesc(null); })}
                        className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-[var(--ic-heading)] text-xs font-semibold">Save</button>
                      <button onClick={() => setEditDesc(null)}
                        className="px-3 py-1.5 rounded bg-[var(--ic-surface-2)] hover:bg-slate-600 text-[var(--ic-text)] text-xs">Cancel</button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              ticket.description && <p className="text-sm text-[var(--ic-text)] whitespace-pre-wrap">{ticket.description}</p>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Asset" value={ticket.asset || '—'} />
              <Info label="CVE" value={ticket.vulnerability_ref || '—'} />
              {editable ? (
                <div>
                  <p className="text-[11px] uppercase text-[var(--ic-muted)] tracking-wide">Assignee</p>
                  <input defaultValue={ticket.assignee || ''} onBlur={e => { if (e.target.value !== (ticket.assignee || '')) act(() => ticketsApi.update(ticket.uid, { assignee: e.target.value })); }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    placeholder="Assign technician…"
                    className="mt-1 w-full bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded px-2 py-1 text-sm text-[var(--ic-heading)] outline-none focus:border-cyan-500" />
                </div>
              ) : <Info label="Assignee" value={ticket.assignee || 'Unassigned'} />}
              <Info label="Reporter" value={ticket.reporter || '—'} />
              <Info label="Escalation level" value={String(ticket.escalation_level)} />
              <Info label="Created" value={`${ago(ticket.created_at)} ago`} />
            </div>

            {/* Quick actions toolbar on the drawer (right side): attach file + track work */}
            {editable && (
              <div className="flex flex-wrap gap-2">
                <input ref={fileRef2} type="file" multiple className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.txt,.md,.log,.csv,.json,.yml,.yaml,.conf,.cfg,.ini,.xml,.pcap,.cap"
                  onChange={e => uploadFiles(e.target.files)} />
                <button onClick={() => fileRef2.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-[var(--ic-heading)] text-xs font-semibold">
                  <Paperclip size={13} className="text-cyan-400" /> Attach file
                </button>
                <button onClick={() => { setTab('evidence'); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-[var(--ic-heading)] text-xs font-semibold">
                  <FileText size={13} className="text-purple-400" /> Track work ({evidence.length})
                </button>
              </div>
            )}

            <Section icon={<Bot size={16} className="text-purple-400" />} title="AI-Assisted Triage">
              {ticket.ai_category ? (
                <div className="text-sm space-y-1">
                  <p className="text-[var(--ic-text)]">Suggested: <b className="text-purple-300">{ticket.ai_category}</b> · priority <b className="text-purple-300">{(ticket.ai_priority || '').toUpperCase()}</b> · confidence <b>{Math.round((ticket.ai_confidence || 0) * 100)}%</b></p>
                  {ticket.duplicate_of && <p className="text-amber-400">⚠ Possible duplicate of {ticket.duplicate_of}</p>}
                  {ticket.ai_predicted_root_cause && <p className="text-[var(--ic-muted)]">Predicted root cause: {ticket.ai_predicted_root_cause}</p>}
                  <ul className="list-disc list-inside text-xs text-[var(--ic-muted)]">{ticket.ai_reasoning.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              ) : <p className="text-sm text-[var(--ic-muted)]">No classification yet.</p>}
            </Section>

            <Section icon={<Clock size={16} className="text-cyan-400" />} title="SLA & Breach Prediction">
              <div className="text-sm space-y-1">
                <p>Response due: <b>{fmt(ticket.due_response_at)}</b> {ticket.first_response_at ? <span className="text-emerald-400">✓ met</span> : <span className={slaColor[ticket.sla_state || '']}>{ticket.sla_state}</span>}</p>
                <p>Resolution due: <b>{fmt(ticket.due_resolve_at)}</b></p>
                {ticket.breach_prediction && (
                  <p className={`font-semibold ${ticket.breach_prediction.risk === 'high' ? 'text-red-400' : ticket.breach_prediction.risk === 'medium' ? 'text-orange-400' : 'text-emerald-400'}`}>
                    Breach risk: {ticket.breach_prediction.risk?.toUpperCase()} — {ticket.breach_prediction.reason}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {STATUSES.filter(s => s !== ticket.status).map(s => (
                  <button key={s} onClick={patch({ status: s })}
                    className="px-2 py-1 rounded bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-xs text-[var(--ic-text)] capitalize">→ {s}</button>
                ))}
              </div>
            </Section>
          </div>
        )}

        {tab === 'audit' && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--ic-muted)] flex items-center gap-1"><Lock size={12} /> Hash-chained immutable audit trail — each entry links to the previous hash.</p>
            {[...audit].reverse().map(a => (
              <div key={a.seq} className="bg-[var(--ic-surface)] rounded-lg p-3 text-sm">
                <div className="flex justify-between text-xs text-[var(--ic-muted)]"><span>#{a.seq} · {a.actor}</span><span>{fmt(a.created_at)}</span></div>
                <p className="text-[var(--ic-heading)] font-medium">{a.action}</p>
                {a.detail && <p className="text-[var(--ic-muted)] text-xs">{a.detail}</p>}
                <p className="text-[10px] font-mono text-[var(--ic-muted)] truncate">prev {a.prev_hash.slice(0, 12)}… → {a.entry_hash.slice(0, 12)}…</p>
              </div>
            ))}
          </div>
        )}

        {tab === 'evidence' && (
          <div className="space-y-3">
            <p className="text-xs text-[var(--ic-muted)] flex items-center gap-1"><FileText size={12} /> Evidence vault — content-addressed (SHA-256), append-only.</p>
            {evidence.map(e => (
              <div key={e.id} className="bg-[var(--ic-surface)] rounded-lg p-3 text-sm flex items-center justify-between">
                <div>
                  <p className="text-[var(--ic-heading)]">{e.name} <Badge className="bg-[var(--ic-surface-2)] text-[var(--ic-text)] ml-1">{e.kind}</Badge></p>
                  <p className="text-[10px] font-mono text-[var(--ic-muted)]">sha256:{e.sha256.slice(0, 24)}… · {e.size_kb} KB · {e.collected_by}</p>
                </div>
                <div className="flex items-center gap-2">
                  {(e as any).has_file && (
                    <button title="Download attachment" onClick={() => ticketsApi.downloadEvidence(ticket.uid, e.id, e.name).catch(ex => setErr(ex.message || 'Download failed'))}
                      className="p-1.5 rounded bg-[var(--ic-surface-2)] hover:bg-cyan-600 text-[var(--ic-text)]"><Download size={13} /></button>
                  )}
                  {e.immutable && <Lock size={14} className="text-emerald-400" />}
                </div>
              </div>
            ))}
            <div className="bg-[var(--ic-surface)] rounded-lg p-3 space-y-2">
              <div className="flex gap-2">
                <input className="flex-1 bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded px-2 py-1 text-sm text-[var(--ic-heading)]" placeholder="Evidence name" value={evName} onChange={e => setEvName(e.target.value)} />
                <select className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded px-2 py-1 text-sm text-[var(--ic-heading)]" value={evKind} onChange={e => setEvKind(e.target.value)}>
                  {['log', 'screenshot', 'pcap', 'config', 'report', 'note'].map(k => <option key={k}>{k}</option>)}
                </select>
              </div>
              <textarea className="w-full bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded px-2 py-1 text-sm text-[var(--ic-heading)]" rows={2} placeholder="Paste evidence content…" value={evContent} onChange={e => setEvContent(e.target.value)} />
              <button onClick={() => act(async () => { await ticketsApi.addEvidence(ticket.uid, { name: evName || 'evidence', kind: evKind, content: evContent }); setEvName(''); setEvContent(''); })}
                className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-[var(--ic-heading)] text-sm font-semibold">Add to vault</button>
            </div>
          </div>
        )}

        {tab === 'approvals' && (
          <div className="space-y-3">
            <p className="text-xs text-[var(--ic-muted)]">Evidence-based closure workflow: request closure → approval steps decided by role.</p>
            {!['resolved', 'closed'].includes(ticket.status) && (
              <div className="bg-[var(--ic-surface)] rounded-lg p-3 space-y-2">
                <textarea className="w-full bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded px-2 py-1 text-sm text-[var(--ic-heading)]" rows={2} placeholder="Closure justification (root cause, fix, evidence refs)…" value={closureNote} onChange={e => setClosureNote(e.target.value)} />
                <button onClick={() => act(() => ticketsApi.closureRequest(ticket.uid, closureNote))}
                  className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-[var(--ic-heading)] text-sm font-semibold">Request Closure</button>
              </div>
            )}
            {approvals.map(ap => (
              <div key={ap.id} className="bg-[var(--ic-surface)] rounded-lg p-3 text-sm">
                <div className="flex justify-between items-center">
                  <p className="text-[var(--ic-heading)]">Step {ap.step}: <b>{ap.approver_role}</b></p>
                  <Badge className={ap.status === 'approved' ? 'bg-emerald-500/20 text-emerald-300' : ap.status === 'rejected' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}>{ap.status}</Badge>
                </div>
                {ap.note && <p className="text-xs text-[var(--ic-muted)] mt-1">{ap.note}</p>}
                {ap.decided_by && <p className="text-[11px] text-[var(--ic-muted)]">by {ap.decided_by} · {fmt(ap.decided_at)}</p>}
                {ap.status === 'pending' && (user?.role === 'client_admin' || user?.role === 'platform_admin') && (
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => act(() => ticketsApi.decide(ticket.uid, ap.id, true, 'Verified evidence attached.'))}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 text-[var(--ic-heading)] text-xs"><CheckCircle2 size={13} /> Approve</button>
                    <button onClick={() => act(() => ticketsApi.decide(ticket.uid, ap.id, false, 'Insufficient evidence.'))}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-red-600 text-[var(--ic-heading)] text-xs"><XCircle size={13} /> Reject</button>
                  </div>
                )}
              </div>
            ))}
            {approvals.length === 0 && <p className="text-sm text-[var(--ic-muted)]">No approval workflow started.</p>}
          </div>
        )}
      </aside>
    </div>
  );
};

const Info: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div><p className="text-[11px] uppercase text-[var(--ic-muted)] tracking-wide">{label}</p><p className="text-[var(--ic-heading)]">{value}</p></div>
);
const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="bg-[var(--ic-surface)] rounded-lg p-4">
    <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--ic-heading)] mb-2">{icon}{title}</h3>
    {children}
  </div>
);

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const AdvancedTicketingPage: React.FC = () => {
  const { user } = useAuth();
  const isPlatform = user?.role === 'platform_admin';
  const [tickets, setTickets] = useState<AdvTicket[]>([]);
  const [tenants, setTenants] = useState<TenantRef[]>([]);
  const [workload, setWorkload] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fPrio, setFPrio] = useState('');
  const [fOrg, setFOrg] = useState<number | ''>('');   // tenant filter → sent as ?org_id= to the API
  const [selected, setSelected] = useState<AdvTicket | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showWorkload, setShowWorkload] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const list = await ticketsApi.list({
        q: q || undefined, status: fStatus || undefined, priority: fPrio || undefined,
        org_id: isPlatform && fOrg !== '' ? Number(fOrg) : undefined,
      });
      setTickets(list);
      if (isPlatform) {
        const [tn, wl] = await Promise.all([ticketsApi.tenants(), ticketsApi.workload().catch(() => [])]);
        setTenants(tn); setWorkload(wl);
      }
    } catch (ex: any) {
      setError(ex instanceof ApiError ? ex.message : 'Backend unreachable — is the API container running?');
    } finally { setLoading(false); }
  }, [q, fStatus, fPrio, fOrg, isPlatform]);

  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  const stats = useMemo(() => ({
    open: tickets.filter(t => !['resolved', 'closed'].includes(t.status)).length,
    breached: tickets.filter(t => t.sla_state === 'breached').length,
    atRisk: tickets.filter(t => t.sla_state === 'at_risk').length,
    auto: tickets.filter(t => t.source === 'alert_engine').length,
  }), [tickets]);

  const selCls = 'bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)] outline-none';

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2"><Inbox className="text-cyan-400" /> Advanced Ticketing</h1>
          <p className="text-sm text-[var(--ic-muted)]">Live data from the ticketing service — AI triage, SLA engines, evidence vault and approval workflows.</p>
        </div>
        <div className="flex gap-2">
          {isPlatform && (
            <button onClick={() => setShowWorkload(v => !v)} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-heading)] text-sm"><Users size={16} /> Team Workload</button>
          )}
          <button onClick={load} className="p-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-text)]"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-[var(--ic-heading)] text-sm font-semibold"><Plus size={16} /> Create Ticket</button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Active Tickets" value={stats.open} color="text-cyan-400" icon={<Inbox size={18} />} />
        <Kpi label="SLA Breached" value={stats.breached} color="text-red-400" icon={<AlertOctagon size={18} />} />
        <Kpi label="At Risk (predicted)" value={stats.atRisk} color="text-orange-400" icon={<Clock size={18} />} />
        <Kpi label="Auto-created from Alerts" value={stats.auto} color="text-purple-400" icon={<GitBranch size={18} />} />
      </div>

      {showWorkload && isPlatform && (
        <div className="bg-[var(--ic-surface-2)] rounded-xl p-4">
          <h3 className="text-sm font-bold text-[var(--ic-heading)] mb-3">Multi-tenant Team Workload</h3>
          {workload.length === 0 ? <p className="text-sm text-[var(--ic-muted)]">No open tickets across tenants.</p> : (
            <div className="grid md:grid-cols-3 gap-3">
              {workload.map(w => (
                <div key={w.org_id ?? w.assignee} className="bg-[var(--ic-surface)] rounded-lg p-3 text-sm">
                  <p className="text-[var(--ic-heading)] font-semibold">{w.tenant || w.assignee || 'Unassigned'}</p>
                  <p className="text-xs text-[var(--ic-muted)]">open: {w.open} · breached: <span className={w.breached > 0 ? 'text-red-400' : ''}>{w.breached}</span> · p1/p2: {w.p1_p2}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filters — all applied server-side */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-52">
          <Search size={16} className="absolute left-3 top-2.5 text-[var(--ic-muted)]" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search title / description / asset / CVE…"
            className="w-full bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg pl-9 pr-3 py-2 text-sm text-[var(--ic-heading)] outline-none focus:border-cyan-500" />
        </div>
        <select className={selCls} value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option value="">All statuses</option>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={selCls} value={fPrio} onChange={e => setFPrio(e.target.value)}>
          <option value="">All priorities</option>{PRIORITIES.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
        </select>
        {isPlatform && (
          <select className={selCls} value={fOrg} onChange={e => setFOrg(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">All tenants</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 text-sm text-red-300 flex items-center gap-2"><ShieldAlert size={16} />{error}</div>}

      {/* Ticket table */}
      <div className="bg-[var(--ic-surface)] rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-[var(--ic-muted)] border-b border-[var(--ic-border)]">
            <th className="px-4 py-3">UID</th><th className="px-4 py-3">Title</th>{isPlatform && <th className="px-4 py-3">Tenant</th>}
            <th className="px-4 py-3">Priority</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">SLA</th>
            <th className="px-4 py-3">Assignee</th><th className="px-4 py-3">Age</th>
          </tr></thead>
          <tbody>
            {loading && tickets.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--ic-muted)]">Loading from backend…</td></tr>}
            {!loading && tickets.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center">
                <p className="text-[var(--ic-muted)] mb-2">No tickets yet — the backend is live and waiting for real data.</p>
                <p className="text-xs text-[var(--ic-muted)] mb-4">Every alert ingested through <code className="text-cyan-400">POST /api/alerts</code> that matches an automation rule creates a ticket here instantly. You can also create one manually.</p>
                <button onClick={() => setShowCreate(true)} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-[var(--ic-heading)] text-sm font-semibold inline-flex items-center gap-2"><Play size={14} /> Create your first ticket</button>
              </td></tr>
            )}
            {tickets.map(t => (
              <tr key={t.uid} onClick={() => setSelected(t)}
                className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface-2)] cursor-pointer">
                <td className="px-4 py-3 font-mono text-xs text-[var(--ic-muted)]">{t.uid}</td>
                <td className="px-4 py-3 text-[var(--ic-heading)]">
                  {t.title}
                  {t.source === 'alert_engine' && <Badge className="ml-2 bg-purple-500/20 text-purple-300 border-purple-500/30">auto ← alert</Badge>}
                  {t.duplicate_of && <Badge className="ml-2 bg-amber-500/20 text-amber-300">dup?</Badge>}
                </td>
                {isPlatform && <td className="px-4 py-3 text-[var(--ic-muted)]">{tenants.find(x => x.id === t.org_id)?.name || `#${t.org_id}`}</td>}
                <td className="px-4 py-3"><Badge className={prioColor[t.priority]}>{t.priority.toUpperCase()}</Badge></td>
                <td className="px-4 py-3"><Badge className={statusColor[t.status]}>{t.status}</Badge></td>
                <td className={`px-4 py-3 text-xs font-semibold uppercase ${slaColor[t.sla_state || ''] || 'text-[var(--ic-muted)]'}`}>{t.sla_state || '—'}</td>
                <td className="px-4 py-3 text-[var(--ic-muted)]">{t.assignee || '—'}</td>
                <td className="px-4 py-3 text-[var(--ic-muted)]">{ago(t.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--ic-muted)] flex items-center gap-1"><RefreshCw size={11} /> Escalation policies run automatically in the backend worker; “Run escalations now” triggers them on demand.</p>
      <button onClick={() => ticketsApi.runEscalations().then(load).catch(e => setError(e.message))}
        className="text-xs px-3 py-1.5 rounded bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-text)] border border-[var(--ic-border)]">Run escalation sweep now</button>

      {showCreate && (
        <CreateTicketModal tenants={tenants} isPlatform={isPlatform} onClose={() => setShowCreate(false)}
          onCreate={async d => { await ticketsApi.create(d); await load(); }} />
      )}
      {selected && <DetailDrawer ticket={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: number; color: string; icon: React.ReactNode }> = ({ label, value, color, icon }) => (
  <div className="bg-[var(--ic-surface-2)] rounded-xl p-4 flex items-center gap-3">
    <div className={`${color}`}>{icon}</div>
    <div><p className={`text-2xl font-bold ${color}`}>{value}</p><p className="text-xs text-[var(--ic-muted)]">{label}</p></div>
  </div>
);

export default AdvancedTicketingPage;
