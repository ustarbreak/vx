// OpsConsole — reusable action toolbar for every Security Services &
// Protection page. Renders grouped action buttons (push config, isolate
// host, run scan, extract syslog/SNMP/OID, launch playbook…), opens a small
// parameter modal when an action needs inputs, executes through
// src/services/securityOps.ts and shows the engine output in a console panel.
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play, Terminal, Download, X, Loader2, Zap, Shield, Mail, Cloud, Globe, Lock,
  Wifi, Network, Scan, Wrench, Database, Search, FileText, Eye, AlertTriangle,
  Ban, RefreshCw, Upload, Radio, Activity, Calendar, History, Link2, BookOpen,
  CheckCircle, ChevronDown, ExternalLink, Cpu, Server, Timer, Layers, ListChecks,
} from 'lucide-react';
import {
  ActionGroup, SecurityActionDef, RunResult, runSecurityAction, downloadActionLog,
} from '../../services/securityOps';

const ICONS: Record<string, React.ComponentType<any>> = {
  Zap, Shield, Mail, Cloud, Globe, Lock, Wifi, Network, Scan, Wrench, Database,
  Search, FileText, Eye, AlertTriangle, Ban, RefreshCw, Upload, Radio, Activity,
  Calendar, History, Link2, BookOpen, CheckCircle, ExternalLink, Cpu, Server,
  Timer, Layers, ListChecks, Play, Terminal, Download,
};

interface Props {
  service: string;              // service id used by the backend router
  title?: string;
  groups: ActionGroup[];
  /** Pre-fill parameters coming from the current row/context (device, ip…). */
  contextParams?: Record<string, string>;
  /** Optional extra text appended to downloaded logs. */
  logHeader?: string;
}

export default function OpsConsole({ service, title, groups, contextParams, logHeader }: Props) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<{ action: SecurityActionDef; fields: { name: string; label: string; placeholder?: string; options?: string[]; default?: string }[] } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunResult[]>([]);
  const [showOutput, setShowOutput] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const lastResult = results[0];

  const openAction = (g: ActionGroup, a: SecurityActionDef) => {
    // Actions with no required params run immediately.
    if (!g.fields || g.fields.length === 0) {
      void execute(a, { ...(contextParams || {}) });
      return;
    }
    const defaults: Record<string, string> = { ...(contextParams || {}) };
    g.fields.forEach((f) => { if (f.default && !(f.name in defaults)) defaults[f.name] = f.default; });
    setValues(defaults);
    setPending({ action: a, fields: g.fields });
  };

  const execute = async (a: SecurityActionDef, params: Record<string, string>) => {
    setRunning(true);
    const res = await runSecurityAction(service, a, params);
    setResults((prev) => [res, ...prev].slice(0, 12));
    setRunning(false);
    setPending(null);
  };

  const toggleGroup = (t: string) => setExpanded((e) => ({ ...e, [t]: !e[t] }));

  const relatedLinks = useMemo(() => ([
    { label: 'Related Alerts', path: '/client-admin/alerts', icon: AlertTriangle },
    { label: 'Tickets', path: '/client-admin/tickets', icon: FileText },
    { label: 'Affected Assets', path: '/client-admin/infrastructure', icon: Server },
    { label: 'Playbooks / SOAR', path: '/client-admin/soar', icon: Zap },
    { label: 'MITRE ATT&CK', href: 'https://attack.mitre.org/' },
    { label: 'NVD / CVE Portal', href: 'https://nvd.nist.gov/vuln/search' },
  ]), []);

  return (
    <div className="bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--ic-border)] flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-cyan-400" />
          <h2 className="text-lg font-semibold text-[var(--ic-heading)]">{title || 'Response & Operations Console'}</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {relatedLinks.map((l) => (
            l.href ? (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer"
                 className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-[var(--ic-border)] text-gray-300 hover:text-cyan-300 hover:border-cyan-500/40 transition-colors">
                <ExternalLink className="w-3.5 h-3.5" />{l.label}
              </a>
            ) : (
              <button key={l.label} onClick={() => navigate(l.path)}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-[var(--ic-border)] text-gray-300 hover:text-cyan-300 hover:border-cyan-500/40 transition-colors">
                <l.icon className="w-3.5 h-3.5" />{l.label}
              </button>
            )
          ))}
        </div>
      </div>

      <div className="p-6 space-y-5">
        {groups.map((g) => {
          const Icon = ICONS[g.icon] || Zap;
          const open = expanded[g.title] ?? true;
          return (
            <div key={g.title}>
              <button onClick={() => toggleGroup(g.title)}
                      className="flex items-center gap-2 text-sm font-semibold text-gray-300 mb-2 hover:text-[var(--ic-heading)]">
                <Icon className={`w-4 h-4 ${g.danger ? 'text-red-400' : 'text-cyan-400'}`} />
                {g.title}
                <ChevronDown className={`w-4 h-4 transition-transform ${open ? '' : '-rotate-90'}`} />
              </button>
              {open && (
                <div className="flex flex-wrap gap-2">
                  {g.actions.map((a) => (
                    <button key={a.id} disabled={running}
                            onClick={() => openAction(g, a)}
                            className={`text-xs px-3 py-2 rounded-lg border font-medium transition-colors disabled:opacity-50 ${
                              g.danger
                                ? 'border-red-500/40 text-red-300 hover:bg-red-500/10'
                                : 'border-[var(--ic-border)] text-gray-300 hover:border-cyan-500/50 hover:text-cyan-300 bg-[var(--ic-surface)]'
                            }`}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Result console */}
      {results.length > 0 && (
        <div className="border-t border-[var(--ic-border)]">
          <div className="flex items-center justify-between px-6 py-2">
            <button onClick={() => setShowOutput((s) => !s)}
                    className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-400 hover:text-gray-200">
              <Activity className="w-4 h-4" /> Last operations ({results.length})
              <ChevronDown className={`w-4 h-4 transition-transform ${showOutput ? '' : '-rotate-90'}`} />
            </button>
            <button onClick={() => downloadActionLog(
                        `${service}-ops-log-${Date.now()}.txt`,
                        (logHeader ? logHeader + '\n' : '') + results.map((r) => `### ${r.actionId} [${r.ok ? 'OK' : 'FAILED'}]\n${r.message}\n${r.output ?? ''}`).join('\n\n'))}
                    className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300">
              <Download className="w-3.5 h-3.5" /> Export console log
            </button>
          </div>
          {showOutput && (
            <div className="px-6 pb-4 space-y-3 max-h-72 overflow-y-auto">
              {results.map((r, i) => (
                <div key={i} className={`rounded-lg border p-3 ${r.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                  <div className="flex items-center gap-2 text-xs mb-1">
                    {r.ok ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-red-400" />}
                    <span className="font-semibold text-[var(--ic-heading)]">{r.actionId}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${r.source === 'demo' ? 'bg-fuchsia-500/20 text-fuchsia-300' : 'bg-emerald-500/20 text-emerald-300'}`}>{r.source}</span>
                  </div>
                  <p className="text-xs text-gray-300 mb-1">{r.message}</p>
                  {r.output && <pre className="text-[11px] leading-relaxed font-mono text-gray-400 whitespace-pre-wrap">{r.output}</pre>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Parameter modal */}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !running && setPending(null)}>
          <div className="bg-[#0d1420] border border-[var(--ic-border)] rounded-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[var(--ic-heading)] flex items-center gap-2">
                <Play className="w-4 h-4 text-cyan-400" /> {pending.action.label}
              </h3>
              <button onClick={() => setPending(null)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3 mb-5">
              {pending.fields.map((f) => (
                <div key={f.name}>
                  <label className="block text-xs text-gray-400 mb-1">{f.label}</label>
                  {f.options ? (
                    <select value={values[f.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                            className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-3 py-2 text-sm border border-[var(--ic-border)] focus:outline-none focus:ring-2 focus:ring-cyan-500">
                      {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input value={values[f.name] ?? ''} placeholder={f.placeholder}
                           onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                           className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-3 py-2 text-sm border border-[var(--ic-border)] focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setPending(null)} className="px-4 py-2 text-sm rounded-lg border border-[var(--ic-border)] text-gray-300 hover:text-white">Cancel</button>
              <button disabled={running}
                      onClick={() => execute(pending.action, values)}
                      className="px-4 py-2 text-sm rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium flex items-center gap-2 disabled:opacity-60">
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                {running ? 'Dispatching…' : 'Run action'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
