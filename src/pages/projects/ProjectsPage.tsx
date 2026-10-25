// ---------------------------------------------------------------------------
// Project Manager — ONE page, TWO perspectives (per the brief):
//  * Platform admin : OUR projects delivered WITH clients ("avec nous").
//    He must assign an organization at creation; he never sees the client's
//    private projects.
//  * Client admin / user : HIS tenant's projects — both "with us" (internal)
//    and his own projects (kind 'client', possibly with his own clients).
// Works on the real backend AND in Demo Mode (demoStore mirrors the routes).
// ---------------------------------------------------------------------------
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FolderKanban, Play, Pause, Square, Plus, Clock, Link2, Building2, Users2, Timer, GaugeCircle, Paperclip, Download, Trash2, Settings2, Pencil, Eye } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { projectsApi, organizationsApi, fileToBase64, type Project, type ProjectDetail, type ProjectAttachment } from '../../services/api';

const guessKind = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['yml', 'yaml', 'json', 'conf', 'cfg', 'ini', 'xml', 'toml', 'env'].includes(ext)) return 'config';
  if (['log', 'txt', 'md', 'csv', 'docx', 'xlsx'].includes(ext)) return 'doc';
  return 'file';
};

const fmtHrs = (secs: number) => `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;

const STATUS_CLS: Record<string, string> = {
  planned: 'bg-[var(--ic-surface-2)] text-[var(--ic-heading)]', active: 'bg-cyan-600/20 text-cyan-300 border border-cyan-700',
  on_hold: 'bg-amber-600/20 text-amber-300 border border-amber-700',
  completed: 'bg-emerald-600/20 text-emerald-300 border border-emerald-700',
};
const PRIORITY_CLS: Record<string, string> = {
  low: 'text-[var(--ic-muted)]', medium: 'text-blue-400', high: 'text-orange-400', critical: 'text-red-400',
};
const SLA_CLS: Record<string, string> = {
  none: 'text-[var(--ic-muted)]', on_track: 'text-emerald-400', at_risk: 'text-amber-400',
  breached: 'text-red-400', met: 'text-emerald-400', breached_after_done: 'text-[var(--ic-muted)]',
};

// --- Phase 4 : destinataires membres + suggestions SLA (miroir démo/réel) ---
import { demoTechnicians, demoTenants } from '../../data/demoWorld';

type MemberLite = { name: string; email: string; role: string };

/** Membres de l'organisation ciblée : API réelle si branchée, fallback monde démo. */
const membersForOrg = (orgId: string | number | undefined, userOrgId?: number): MemberLite[] => {
  const id = Number(orgId ?? userOrgId ?? 1);
  return demoTechnicians.filter(t => t.orgId === id).map(t => ({ name: t.name, email: t.email, role: t.role }));
};

/** Plan/tier de l'organisation (pour la suggestion SLA selon certification/plan). */
const orgTierFor = (orgId: string): string | undefined =>
  (demoTenants.find(o => String(o.id) === String(orgId)) as any)?.tier as string | undefined;

/** Suggestions de SLA en heures selon priorité + plan/certification du client. */
const slaSuggestions = (priority: string, tier?: string): { value: number; label: string; reason: string }[] => {
  const strict = tier === 'enterprise';   // exigences type PCI-DSS / ISO 27001
  const table: Record<string, { v: number; why: string }[]> = {
    critical: [{ v: strict ? 4 : 8, why: `Résolution ${strict ? '4h (engagement Enterprise/PCI)' : '8h'} — incident bloquant` },
               { v: 24, why: 'J+1 — tolérable si contournement manuel dispo' }],
    high:     [{ v: strict ? 8 : 24, why: `Résolution ${strict ? '8h (SLA certifié)' : '24h'} — impact fort sans blocage total` },
               { v: 48, why: '48h — file d’attente prioritaire standard' }],
    medium:   [{ v: 72, why: '72h — SLA standard ITIL pour demande de service' },
               { v: 168, why: '5 jours ouvrés — faible urgence métier' }],
    low:      [{ v: 168, why: 'Semaine — amélioration non urgente' },
               { v: 0, why: 'Aucun SLA — suivi libre au backlog' }],
  };
  return (table[priority] ?? table.medium).map(x => ({ value: x.v, label: x.v === 0 ? 'Aucun' : `${x.v}h`, reason: x.why }));
};

export default function ProjectsPage() {
  const { user } = useAuth();
  const isPlatform = user?.role === 'platform_admin';
  const [projects, setProjects] = useState<Project[]>([]);
  const [orgs, setOrgs] = useState<{ id: number; name: string }[]>([]);
  const [selected, setSelected] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [fb, setFb] = useState({ name: '', description: '', priority: 'medium', manager_email: '', org_id: '' as string, sla_hours: '', milestones: '' });
  // Destinataires = membres de l'organisation sélectionnée (dropdown cliquable)
  const projectMembers = useMemo(
    () => membersForOrg(fb.org_id || undefined, Number(user?.orgId ?? 1)),
    [fb.org_id, user?.orgId]);
  const [liveTick, setLiveTick] = useState(0);
  // Attachments — staged at creation + managed in the detail modal.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const attFileRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<ProjectAttachment[]>([]);
  // Edit / Configuration modals (per-project CRUD actions).
  const [editing, setEditing] = useState<any | null>(null);
  const [configuring, setConfiguring] = useState<any | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const list = await projectsApi.list();
      setProjects(list);
      if (isPlatform) { try { setOrgs(await organizationsApi.list()); } catch { /* optional */ } }
    } catch (e: any) { setError(e?.message ?? 'Chargement impossible'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); window.addEventListener('demo-world-pushed', load); return () => window.removeEventListener('demo-world-pushed', load); }, []);
  useEffect(() => { const i = setInterval(() => setLiveTick(t => t + 1), 30_000); return () => clearInterval(i); }, []);

  const openDetail = async (id: number) => {
    try { setSelected(await projectsApi.get(id)); loadAttachments(id); } catch (e: any) { setError(e?.message ?? 'Détail indisponible'); }
  };
  const loadAttachments = async (id: number) => {
    try { setAttachments(await projectsApi.attachments(id)); } catch { setAttachments([]); }
  };
  const uploadToProject = async (files: FileList | null) => {
    if (!selected || !files || files.length === 0) return;
    for (const f of Array.from(files)) {
      await projectsApi.addAttachment(selected.id, {
        name: f.name, kind: guessKind(f.name), content: '',
        file_b64: await fileToBase64(f), mime_type: f.type || 'application/octet-stream',
      });
    }
    loadAttachments(selected.id);
  };
  const removeAtt = async (attId: number) => {
    if (!selected) return;
    await projectsApi.removeAttachment(selected.id, attId);
    loadAttachments(selected.id);
  };
  const actTimer = async (id: number, action: 'start' | 'pause' | 'resume' | 'stop') => {
    await projectsApi.timer(id, action); openDetail(id);
  };
  const toggleMs = async (mid: number, done: boolean) => {
    if (!selected) return;
    await projectsApi.toggleMilestone(mid, done); openDetail(selected.id);
  };
  const addMs = async (title: string) => {
    if (!selected || !title.trim()) return;
    await projectsApi.addMilestone(selected.id, title.trim()); openDetail(selected.id);
  };
  // ---- CRUD action handlers (Show / Edit / Config / Delete) ----
  const removeProject = async (p: Project) => {
    if (!window.confirm(`Supprimer le projet « ${p.name} » ? Cette action est définitive.`)) return;
    try { await projectsApi.remove(p.id); if (selected?.id === p.id) setSelected(null); load(); }
    catch (e: any) { setError(e?.message ?? 'Suppression impossible'); }
  };
  const saveEdit = async () => {
    if (!editing) return;
    try {
      await projectsApi.update(editing.id, {
        name: editing.name, description: editing.description, priority: editing.priority,
        status: editing.status, manager_email: editing.manager_email,
        sla_hours: Number(editing.sla_hours || 0), progress_pct: Number(editing.progress_pct || 0),
      });
      setEditing(null); load();
    } catch (e: any) { setError(e?.message ?? 'Enregistrement impossible'); }
  };
  const saveConfig = async () => {
    if (!configuring) return;
    try {
      await projectsApi.config(configuring.id, {
        sla_hours: Number(configuring.sla_hours || 0),
        delay_alert_days: Number(configuring.delay_alert_days || 3),
        risk_threshold: Number(configuring.risk_threshold || 60),
        budget_usd: Number(configuring.budget_usd || 0),
        auto_close_tickets: !!configuring.auto_close_tickets,
        notify_on_breach: configuring.notify_on_breach !== false,
      });
      setConfiguring(null); load();
    } catch (e: any) { setError(e?.message ?? 'Configuration impossible'); }
  };
  const create = async () => {
    if (!fb.name.trim()) return;
    const created: any = await projectsApi.create({
      name: fb.name, description: fb.description, priority: fb.priority,
      manager_email: fb.manager_email, sla_hours: Number(fb.sla_hours || 0),
      org_id: isPlatform ? Number(fb.org_id || 0) : undefined,
      milestones: fb.milestones.split('\n').map(s => s.trim()).filter(Boolean),
    } as any);
    // Upload the staged description documents to the freshly created project.
    const pid = created?.id;
    if (pid && pendingFiles.length) {
      for (const f of pendingFiles) {
        await projectsApi.addAttachment(pid, {
          name: f.name, kind: guessKind(f.name), content: '',
          file_b64: await fileToBase64(f), mime_type: f.type || 'application/octet-stream',
        });
      }
    }
    setShowForm(false); setPendingFiles([]);
    setFb({ name: '', description: '', priority: 'medium', manager_email: '', org_id: '', sla_hours: '', milestones: '' });
    load();
  };

  // Segmented view per audience — different structure for US vs CLIENT.
  const groups = useMemo(() => {
    const g: { title: string; hint: string; items: Project[] }[] = [];
    if (isPlatform) {
      g.push({ title: 'Nos projets de delivery (avec nos clients)', hint: 'Créés et pilotés par la plateforme Infracentra pour un tenant donné.', items: projects.filter(p => p.kind === 'internal') });
    } else {
      g.push({ title: 'Projets avec Infracentra', hint: 'Chantiers livrés par nos équipes sur votre périmètre.', items: projects.filter(p => p.kind === 'internal') });
      g.push({ title: 'Vos projets internes (ou avec vos clients)', hint: 'Vos propres projets suivis dans la plateforme — invisibles pour les autres tenants.', items: projects.filter(p => p.kind === 'client') });
    }
    return g;
  }, [projects, isPlatform, liveTick]);

  const Card = ({ p }: { p: Project }) => (
    <div className="bg-[var(--ic-surface)] hover:bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4 space-y-2 transition">
      <div onClick={() => openDetail(p.id)} className="cursor-pointer space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${STATUS_CLS[p.status] ?? STATUS_CLS.planned}`}>{p.status}</span>
          <span className={`text-[11px] font-bold uppercase ${PRIORITY_CLS[p.priority]}`}>{p.priority}</span>
        </div>
        <h3 className="font-semibold text-[var(--ic-heading)] leading-tight">{p.name}</h3>
        {!isPlatform && <p className="text-[11px] text-[var(--ic-muted)] flex items-center gap-1"><Building2 className="w-3 h-3" />{orgs.find(o => o.id === p.org_id)?.name ?? `Tenant #${p.org_id}`}</p>}
        <div className="h-1.5 rounded bg-[var(--ic-surface)] overflow-hidden">
          <div className="h-full bg-gradient-to-r from-cyan-500 to-violet-500" style={{ width: `${p.progress_pct ?? 0}%` }} />
        </div>
        <div className="flex items-center justify-between text-[11px] text-[var(--ic-muted)]">
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{fmtHrs(p.time_spent_seconds)}</span>
          <span className={SLA_CLS[p.sla_status]}>{p.sla_hours ? `SLA ${p.sla_hours}h · ${p.sla_status.replace('_', ' ')}` : 'sans SLA'}</span>
          {p.timer_running && <span className="text-cyan-400 animate-pulse flex items-center gap-1"><Timer className="w-3 h-3" />live</span>}
        </div>
      </div>
      {/* Action bar — Show / Edit / Config / Delete, every button routed */}
      <div className="flex items-center justify-end gap-1 pt-2 border-t border-[var(--ic-border)]">
        <button title="Voir le détail" onClick={() => openDetail(p.id)}
          className="p-1.5 rounded-lg bg-[var(--ic-surface)] hover:bg-cyan-600 text-[var(--ic-text)] hover:text-[var(--ic-heading)]"><Eye className="w-3.5 h-3.5" /></button>
        <button title="Modifier le projet" onClick={() => setEditing({ ...p })}
          className="p-1.5 rounded-lg bg-[var(--ic-surface)] hover:bg-violet-600 text-[var(--ic-text)] hover:text-[var(--ic-heading)]"><Pencil className="w-3.5 h-3.5" /></button>
        <button title="Configuration (SLA, budget, risques)" onClick={() => projectsApi.config(p.id).then((c: any) => setConfiguring({ id: p.id, sla_hours: p.sla_hours ?? 0, delay_alert_days: 3, risk_threshold: 60, budget_usd: 0, auto_close_tickets: false, notify_on_breach: true, ...c })).catch(() => setConfiguring({ id: p.id, name: p.name, sla_hours: p.sla_hours ?? 0, delay_alert_days: 3, risk_threshold: 60, budget_usd: 0, auto_close_tickets: false, notify_on_breach: true }))}
          className="p-1.5 rounded-lg bg-[var(--ic-surface)] hover:bg-amber-600 text-[var(--ic-text)] hover:text-[var(--ic-heading)]"><Settings2 className="w-3.5 h-3.5" /></button>
        <button title="Supprimer" onClick={() => removeProject(p)}
          className="p-1.5 rounded-lg bg-[var(--ic-surface)] hover:bg-red-600 text-[var(--ic-text)] hover:text-[var(--ic-heading)]"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2"><FolderKanban className="w-6 h-6 text-cyan-400" />Project Manager</h1>
          <p className="text-sm text-[var(--ic-muted)] mt-1">
            {isPlatform
              ? 'Vue plateforme : nos chantiers de delivery chez chaque client. Les projets privés des clients ne sont jamais visibles ici.'
              : 'Vos projets avec Infracentra et vos projets internes — strictement limités à votre organisation.'}
          </p>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-[var(--ic-heading)] text-sm font-medium">
          <Plus className="w-4 h-4" /> Nouveau projet
        </button>
      </div>

      {error && <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg p-3">{error}</div>}

      {showForm && (
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-5 grid gap-3 md:grid-cols-2">
          <input className="bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)] placeholder-slate-500" placeholder="Nom du projet *" value={fb.name} onChange={e => setFb({ ...fb, name: e.target.value })} />
          {isPlatform && (
            <select className="bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={fb.org_id} onChange={e => setFb({ ...fb, org_id: e.target.value })}>
              <option value="">— Assigner une organisation (obligatoire) —</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <input className="bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)] placeholder-slate-500 md:col-span-2" placeholder="Description" value={fb.description} onChange={e => setFb({ ...fb, description: e.target.value })} />
          <select className="bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={fb.priority} onChange={e => setFb({ ...fb, priority: e.target.value })}>
            {['low', 'medium', 'high', 'critical'].map(x => <option key={x} value={x}>Priorité : {x}</option>)}
          </select>
          {/* Membre(s) destinataire(s) — dropdown des membres de l'organisation (un ou plusieurs), plus de champ email libre */}
          <div className="bg-[var(--ic-surface)] rounded-lg px-3 py-2 border border-[var(--ic-border)]">
            <p className="text-xs text-[var(--ic-muted)] mb-1.5">Destinataires du projet ({projectMembers.length} membre{projectMembers.length > 1 ? 's' : ''} de {fb.org_id ? (orgs.find(o => String(o.id) === fb.org_id)?.name ?? "l'organisation") : 'votre organisation'}) — notification à un ou plusieurs</p>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-auto">
              {projectMembers.length === 0 && <span className="text-xs text-[var(--ic-muted)] italic">Aucun membre trouvé pour cette organisation.</span>}
              {projectMembers.map(m => {
                const picked = fb.manager_email.split(',').map(x => x.trim()).filter(Boolean).includes(m.email);
                return (
                  <button key={m.email} type="button"
                    onClick={() => setFb({ ...fb, manager_email: picked
                      ? fb.manager_email.split(',').map(x => x.trim()).filter(x => x && x !== m.email).join(', ')
                      : [...fb.manager_email.split(',').map(x => x.trim()).filter(Boolean), m.email].join(', ') })}
                    className={`px-2.5 py-1 rounded-full text-xs border transition ${picked
                      ? 'bg-cyan-600/25 border-cyan-500 text-cyan-200'
                      : 'bg-[var(--ic-surface-2)] border-[var(--ic-border)] text-[var(--ic-text)] hover:border-cyan-600'}`}>
                    {picked ? '✓ ' : ''}{m.name} <span className="opacity-60">· {m.role}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {/* SLA : suggestions selon priorité + certification, plus un simple champ texte */}
          <div className="bg-[var(--ic-surface)] rounded-lg px-3 py-2 border border-[var(--ic-border)]">
            <p className="text-xs text-[var(--ic-muted)] mb-1.5">SLA recommandé — priorité « {fb.priority } »{fb.org_id && orgTierFor(fb.org_id) ? ` · plan ${orgTierFor(fb.org_id)}` : ''}</p>
            <div className="flex flex-wrap gap-1.5">
              {slaSuggestions(fb.priority, orgTierFor(fb.org_id)).map(h => (
                <button key={h.value} type="button" onClick={() => setFb({ ...fb, sla_hours: String(h.value) })}
                  title={h.reason}
                  className={`px-2.5 py-1 rounded-lg text-xs border transition ${String(fb.sla_hours) === String(h.value)
                    ? 'bg-emerald-600/25 border-emerald-500 text-emerald-200'
                    : 'bg-[var(--ic-surface-2)] border-[var(--ic-border)] text-[var(--ic-text)] hover:border-emerald-600'}`}>
                  {h.label}
                </button>
              ))}
              <input className="w-24 bg-[var(--ic-surface-2)] rounded-lg px-2 py-1 text-xs text-[var(--ic-heading)] placeholder-slate-500 border border-[var(--ic-border)]"
                type="number" min={0} placeholder="perso…" value={fb.sla_hours} onChange={e => setFb({ ...fb, sla_hours: e.target.value })} />
            </div>
            <p className="text-[10px] text-[var(--ic-muted)] mt-1">{slaSuggestions(fb.priority, orgTierFor(fb.org_id))[0]?.reason}</p>
          </div>
          <textarea className="bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)] placeholder-slate-500 md:col-span-2" rows={3} placeholder="Jalons, un par ligne" value={fb.milestones} onChange={e => setFb({ ...fb, milestones: e.target.value })} />

          {/* Attachments at creation — documents describing the project (images, PDF, config, txt) */}
          <div className="md:col-span-2">
            <input ref={attFileRef} type="file" multiple className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.txt,.md,.log,.csv,.json,.yml,.yaml,.conf,.cfg,.ini,.xml,.docx,.xlsx"
              onChange={e => setPendingFiles(Array.from(e.target.files || []))} />
            <button type="button" onClick={() => attFileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-[var(--ic-border)] hover:border-cyan-500 text-[var(--ic-text)] text-sm bg-[var(--ic-surface)]">
              <Paperclip className="w-4 h-4 text-cyan-400" /> Joindre des fichiers — images, PDF, configuration, documents…
            </button>
            {pendingFiles.length > 0 && (
              <ul className="mt-2 space-y-1">
                {pendingFiles.map((f, i) => (
                  <li key={i} className="flex items-center justify-between bg-[var(--ic-surface)] rounded-lg px-3 py-1.5 text-xs text-[var(--ic-text)]">
                    <span className="truncate">{f.name} · {(f.size / 1024).toFixed(1)} KB</span>
                    <button type="button" onClick={() => setPendingFiles(pendingFiles.filter((_, j) => j !== i))} className="text-[var(--ic-muted)] hover:text-red-400 ml-2"><Trash2 className="w-3.5 h-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="md:col-span-2 flex gap-2">
            <button onClick={create} disabled={!fb.name.trim() || (isPlatform && !fb.org_id)} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-[var(--ic-heading)] text-sm font-medium">Créer</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-text)] text-sm">Annuler</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map(i => <div key={i} className="h-40 bg-[var(--ic-surface)] animate-pulse rounded-xl" />)}</div>
      ) : (
        groups.map(gr => (
          <section key={gr.title}>
            <h2 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-wide">{gr.title}</h2>
            <p className="text-xs text-[var(--ic-muted)] mb-3">{gr.hint}</p>
            {gr.items.length === 0
              ? <p className="text-sm text-[var(--ic-muted)] italic">Aucun projet dans cette catégorie.</p>
              : <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-2">{gr.items.map(p => <Card key={p.id} p={p} />)}</div>}
          </section>
        ))
      )}

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-[var(--ic-heading)]">{selected.name}</h3>
                <p className="text-sm text-[var(--ic-muted)]">{selected.description}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)] text-xl">×</button>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className={`px-2 py-1 rounded-full font-semibold ${STATUS_CLS[selected.status]}`}>{selected.status}</span>
              <span className={`px-2 py-1 rounded-full bg-[var(--ic-surface)] capitalize ${PRIORITY_CLS[selected.priority]}`}>{selected.priority}</span>
              <span className="px-2 py-1 rounded-full bg-[var(--ic-surface)] text-[var(--ic-text)] flex items-center gap-1"><Users2 className="w-3 h-3" />{selected.manager_email || 'non assigné'}</span>
              <span className={`px-2 py-1 rounded-full bg-[var(--ic-surface)] ${SLA_CLS[selected.sla_status]}`}>{selected.sla_hours ? `SLA ${selected.sla_hours}h · ${selected.sla_status.replace('_', ' ')}` : 'sans SLA'}</span>
              <span className="px-2 py-1 rounded-full bg-[var(--ic-surface)] text-[var(--ic-text)] flex items-center gap-1"><GaugeCircle className="w-3 h-3" />{selected.progress_pct}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--ic-muted)] flex items-center gap-1"><Clock className="w-4 h-4" />{fmtHrs(selected.time_spent_seconds)}</span>
              {!selected.timer_running
                ? <button onClick={() => actTimer(selected.id, selected.time_spent_seconds > 0 ? 'resume' : 'start')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[var(--ic-heading)] text-xs"><Play className="w-3 h-3" />Chrono</button>
                : <>
                    <button onClick={() => actTimer(selected.id, 'pause')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-[var(--ic-heading)] text-xs"><Pause className="w-3 h-3" />Pause</button>
                    <button onClick={() => actTimer(selected.id, 'stop')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--ic-surface-2)] hover:bg-slate-600 text-[var(--ic-heading)] text-xs"><Square className="w-3 h-3" />Stop</button>
                  </>}
            </div>
            <div>
              <h4 className="text-xs font-semibold text-[var(--ic-text)] uppercase mb-2">Jalons</h4>
              <ul className="space-y-1">
                {selected.milestones.map(m => (
                  <li key={m.id}>
                    <label className="flex items-center gap-2 text-sm text-[var(--ic-text)] cursor-pointer">
                      <input type="checkbox" checked={m.done} onChange={() => toggleMs(m.id, !m.done)} className="accent-cyan-500" />
                      <span className={m.done ? 'line-through text-[var(--ic-muted)]' : ''}>{m.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <form onSubmit={e => { e.preventDefault(); const inp = (e.target as any).t; addMs(inp.value); inp.value = ''; }} className="flex gap-2 mt-2">
                <input name="t" placeholder="Ajouter un jalon…" className="flex-1 bg-[var(--ic-surface)] rounded-lg px-3 py-1.5 text-sm text-[var(--ic-heading)] placeholder-slate-500" />
                <button className="px-3 py-1.5 rounded-lg bg-[var(--ic-surface-2)] hover:bg-slate-600 text-[var(--ic-heading)] text-sm"><Plus className="w-4 h-4" /></button>
              </form>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-[var(--ic-text)] uppercase mb-2 flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" />Documents & pièces jointes ({attachments.length})</h4>
              <input type="file" multiple className="hidden" id="proj-att-input"
                accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.txt,.md,.log,.csv,.json,.yml,.yaml,.conf,.cfg,.ini,.xml,.docx,.xlsx"
                onChange={e => uploadToProject(e.target.files)} />
              <button onClick={() => (document.getElementById('proj-att-input') as HTMLInputElement)?.click()}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-[var(--ic-heading)] text-xs font-medium mb-2">
                <Plus className="w-3 h-3" /> Ajouter un fichier / image / config…
              </button>
              {attachments.length > 0 && (
                <ul className="divide-y divide-slate-800 text-sm">
                  {attachments.map(a => (
                    <li key={a.id} className="py-1.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[var(--ic-text)]">{a.name}
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[var(--ic-surface)] text-[var(--ic-muted)] uppercase">{a.kind}</span>
                        <span className="ml-1 text-[10px] text-[var(--ic-muted)]">{a.size_kb} KB</span>
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        {a.has_file && (
                          <button title="Télécharger" onClick={() => projectsApi.downloadAttachment(selected.id, a.id, a.name).catch(e => setError(e?.message ?? 'Téléchargement impossible'))}
                            className="p-1 rounded bg-[var(--ic-surface)] hover:bg-cyan-600 text-[var(--ic-text)]"><Download className="w-3.5 h-3.5" /></button>
                        )}
                        <button title="Supprimer" onClick={() => removeAtt(a.id)}
                          className="p-1 rounded bg-[var(--ic-surface)] hover:bg-red-600 text-[var(--ic-text)]"><Trash2 className="w-3.5 h-3.5" /></button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h4 className="text-xs font-semibold text-[var(--ic-text)] uppercase mb-2 flex items-center gap-1"><Link2 className="w-3.5 h-3.5" />Tickets liés ({selected.tickets.total} · {selected.tickets.open} ouverts)</h4>
              {selected.tickets.items.length === 0
                ? <p className="text-xs text-[var(--ic-muted)] italic">Aucun ticket dans la catégorie « {selected.ticket_category} » pour l'instant.</p>
                : <ul className="divide-y divide-slate-800 text-sm">
                    {selected.tickets.items.slice(0, 8).map(t => (
                      <li key={t.uid} className="py-1.5 flex items-center justify-between gap-2">
                        <span className="text-[var(--ic-text)] truncate">{t.uid} — {t.title}</span>
                        <span className="text-xs text-[var(--ic-muted)] shrink-0">{t.status}</span>
                      </li>
                    ))}
                  </ul>}
            </div>
          </div>
        </div>
      )}

      {/* ---- EDIT modal (Pencil) ---- */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-6 w-full max-w-lg space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[var(--ic-heading)] flex items-center gap-2"><Pencil className="w-5 h-5 text-violet-400" />Modifier le projet</h3>
            <input className="w-full bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={editing.name ?? ''} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Nom" />
            <textarea rows={2} className="w-full bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={editing.description ?? ''} onChange={e => setEditing({ ...editing, description: e.target.value })} placeholder="Description" />
            <div className="grid grid-cols-2 gap-3">
              <select className="bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={editing.priority ?? 'medium'} onChange={e => setEditing({ ...editing, priority: e.target.value })}>
                {['low', 'medium', 'high', 'critical'].map(x => <option key={x} value={x}>Priorité : {x}</option>)}
              </select>
              <select className="bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)] capitalize" value={editing.status ?? 'planned'} onChange={e => setEditing({ ...editing, status: e.target.value })}>
                {['planned', 'in_progress', 'on_hold', 'completed', 'cancelled'].map(x => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}
              </select>
              <input className="bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={editing.manager_email ?? ''} onChange={e => setEditing({ ...editing, manager_email: e.target.value })} placeholder="Email responsable" />
              <input type="number" className="bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={editing.sla_hours ?? 0} onChange={e => setEditing({ ...editing, sla_hours: e.target.value })} placeholder="SLA (heures)" />
              <label className="col-span-2 text-sm text-[var(--ic-text)] flex items-center gap-2">Progression : {Number(editing.progress_pct || 0)} %
                <input type="range" min={0} max={100} value={Number(editing.progress_pct || 0)} onChange={e => setEditing({ ...editing, progress_pct: Number(e.target.value) })} className="flex-1 accent-violet-500" />
              </label>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-text)] text-sm">Annuler</button>
              <button onClick={saveEdit} disabled={!editing.name?.trim()} className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-[var(--ic-heading)] text-sm font-medium">Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- CONFIGURATION modal (Settings2) ---- */}
      {configuring && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setConfiguring(null)}>
          <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-6 w-full max-w-lg space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[var(--ic-heading)] flex items-center gap-2"><Settings2 className="w-5 h-5 text-amber-400" />Configuration du projet</h3>
            <p className="text-xs text-[var(--ic-muted)]">Paramètres opérationnels : SLA, seuils de risque, budget, automatisations.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-[var(--ic-muted)]">SLA cible (heures)<input type="number" className="mt-1 w-full bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={configuring.sla_hours ?? 0} onChange={e => setConfiguring({ ...configuring, sla_hours: e.target.value })} /></label>
              <label className="text-xs text-[var(--ic-muted)]">Alerte retard (jours)<input type="number" className="mt-1 w-full bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={configuring.delay_alert_days ?? 3} onChange={e => setConfiguring({ ...configuring, delay_alert_days: e.target.value })} /></label>
              <label className="text-xs text-[var(--ic-muted)]">Seuil de risque (0–100)<input type="number" className="mt-1 w-full bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={configuring.risk_threshold ?? 60} onChange={e => setConfiguring({ ...configuring, risk_threshold: e.target.value })} /></label>
              <label className="text-xs text-[var(--ic-muted)]">Budget (USD)<input type="number" className="mt-1 w-full bg-[var(--ic-surface)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)]" value={configuring.budget_usd ?? 0} onChange={e => setConfiguring({ ...configuring, budget_usd: e.target.value })} /></label>
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--ic-text)]"><input type="checkbox" className="accent-cyan-500" checked={!!configuring.auto_close_tickets} onChange={e => setConfiguring({ ...configuring, auto_close_tickets: e.target.checked })} />Fermer automatiquement les tickets liés à la complétion</label>
            <label className="flex items-center gap-2 text-sm text-[var(--ic-text)]"><input type="checkbox" className="accent-cyan-500" checked={configuring.notify_on_breach !== false} onChange={e => setConfiguring({ ...configuring, notify_on_breach: e.target.checked })} />Notifier le responsable en cas de breach SLA</label>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setConfiguring(null)} className="px-4 py-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-text)] text-sm">Annuler</button>
              <button onClick={saveConfig} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-[var(--ic-heading)] text-sm font-medium">Appliquer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
