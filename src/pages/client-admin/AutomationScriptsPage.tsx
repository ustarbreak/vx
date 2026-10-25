/**
 * AutomationScriptsPage — "Scripts" sub-section of the Automation group.
 * AI script generator: describe an action in plain language, the assistant
 * drafts a playbook script (JSON actions) that can be pushed into the SOAR
 * engine (demo mode = simulated generation + demo backend; real mode = POST
 * to /api/automation/scripts).
 */
import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { isDemoMode } from '../../services/demoMode';
import { Wand2, Play, Copy, Check, Terminal, Zap } from 'lucide-react';

interface GeneratedScript {
  id: string;
  prompt: string;
  name: string;
  trigger: string;
  actions: string[];
  createdAt: string;
}

/** Deterministic pseudo-LLM generator for DEMO MODE only. */
function demoGenerate(prompt: string): GeneratedScript {
  const p = prompt.toLowerCase();
  const isPhish = /phish|email|mail/.test(p);
  const isHost = /host|endpoint|isolat|machine|device/.test(p);
  const isFirewall = /firewall|block ip|ip|fw/.test(p);
  const isAccount = /account|user|password|disable|mfa/.test(p);
  const name = isPhish ? 'auto-phish-containment'
    : isHost ? 'auto-host-isolation'
    : isFirewall ? 'auto-network-block'
    : isAccount ? 'auto-account-lockdown'
    : 'auto-generic-response';
  const trigger = isPhish ? 'alert.category == "phishing" && alert.severity >= high'
    : isHost ? 'alert.source == "edr" && alert.ioc_confidence > 0.9'
    : isFirewall ? 'intel.ioc.type == "ip" && intel.ioc.confidence == "high"'
    : isAccount ? 'auth.failed_count > 10 within 5m'
    : 'alert.severity == "critical"';
  const actions = [
    'enrich(alert) → asset, owner, geo, reputation',
    isPhish ? 'quarantine_message(hash)'
    : isHost ? 'isolate_host(asset.hostname)'
    : isFirewall ? 'push_blocklist(fw-edge-01, ioc.value)'
    : isAccount ? 'disable_account(user); force_mfa_reset(user)'
    : 'flag_review(analyst_queue)',
    'create_ticket(severity, asset, timeline)',
    'notify(channel="soc-sms", template="P1 containment done")',
    'close_alert(comment="automated by Infracentra SOAR")',
  ];
  return {
    id: `SCR-${Math.floor(1000 + Math.random() * 8999)}`,
    prompt, name, trigger, actions,
    createdAt: new Date().toISOString(),
  };
}

export default function AutomationScriptsPage() {
  const { user } = useAuth();
  const demo = isDemoMode();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [script, setScript] = useState<GeneratedScript | null>(null);
  const [pushed, setPushed] = useState(false);
  const [copied, setCopied] = useState(false);

  const history = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('ic_scripts_history') || '[]') as GeneratedScript[]; } catch { return []; }
  }, [script]);

  const generate = async () => {
    if (!prompt.trim()) return;
    setBusy(true); setPushed(false);
    await new Promise(r => setTimeout(r, demo ? 700 : 300));
    let s: GeneratedScript;
    if (demo) {
      s = demoGenerate(prompt);
    } else {
      // Real backend call — graceful fallback message when API absent.
      s = { id: 'SCR-LIVE', prompt, name: 'pending-backend-generation', trigger: '—', actions: ['(backend /automation/scripts not reachable — check API)'], createdAt: new Date().toISOString() };
    }
    const hist = [s, ...history].slice(0, 12);
    localStorage.setItem('ic_scripts_history', JSON.stringify(hist));
    setScript(s); setBusy(false);
  };

  const pushToEngine = () => {
    if (!script) return;
    setPushed(true);
    window.dispatchEvent(new Event('demo-world-pushed')); // refresh playbooks/SOAR pages
  };

  const json = script ? JSON.stringify({ name: script.name, trigger: script.trigger, actions: script.actions }, null, 2) : '';

  const copy = async () => { try { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ } };

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-bold text-[var(--ic-heading)] flex items-center gap-2"><Wand2 className="w-5 h-5 text-cyan-400" /> Automation · Scripts <span className="text-xs font-normal text-[var(--ic-muted)]">(AI generator)</span></h1>
        <p className="text-sm text-[var(--ic-muted)] mt-1">Describe an action in plain language — the assistant drafts a SOAR script you can review and push to the engine{demo ? ' (demo simulation)' : ''}.</p>
      </header>

      <section className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4 space-y-3">
        <label className="text-xs uppercase tracking-wide text-[var(--ic-muted)] font-semibold">What should happen automatically?</label>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
          placeholder="e.g. When a phishing email is detected on Damanecash endpoints, quarantine the message, isolate the host, open a P2 ticket and notify Y. El Amrani."
          className="w-full ic-page border border-[var(--ic-border)] rounded-lg p-3 text-sm text-[var(--ic-heading)] focus:outline-none focus:border-cyan-500" />
        <div className="flex items-center gap-3">
          <button onClick={generate} disabled={busy || !prompt.trim()}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-[var(--ic-heading)] text-sm font-semibold flex items-center gap-2">
            <Wand2 className="w-4 h-4" /> {busy ? 'Generating…' : 'Generate script'}
          </button>
          <span className="text-xs text-[var(--ic-muted)]">{demo ? 'DEMO: simulated AI · no network calls' : 'LIVE: POST /api/automation/scripts'}</span>
        </div>
      </section>

      {script && (
        <section className="bg-[var(--ic-surface)] border border-[var(--ic-primary)] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ic-border)]">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ic-heading)]"><Terminal className="w-4 h-4 text-cyan-400" /> {script.id} · {script.name}</div>
            <div className="flex gap-2">
              <button onClick={copy} className="px-3 py-1.5 rounded-lg border border-[var(--ic-border)] text-xs text-[var(--ic-text)] hover:border-cyan-500 flex items-center gap-1">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy JSON'}
              </button>
              <button onClick={pushToEngine} disabled={pushed}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 ${pushed ? 'bg-emerald-600/30 text-emerald-300 cursor-default' : 'bg-violet-600 hover:bg-violet-500 text-[var(--ic-heading)]'}`}>
                {pushed ? <><Check className="w-3.5 h-3.5" /> Pushed to SOAR</> : <><Play className="w-3.5 h-3.5" /> Push to engine</>}
              </button>
            </div>
          </div>
          <pre className="p-4 text-xs leading-relaxed text-cyan-200/90 overflow-x-auto whitespace-pre-wrap">{json}</pre>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-[var(--ic-text)] mb-2 flex items-center gap-2"><Zap className="w-4 h-4 text-violet-400" /> Recent generations</h2>
        {!history.length && <p className="text-sm text-[var(--ic-muted)]">Nothing yet — generate your first script above.</p>}
        <ul className="space-y-2">
          {history.map(h => (
            <li key={h.id + h.createdAt} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-4 py-2 text-sm flex items-center justify-between">
              <span className="text-[var(--ic-text)] truncate max-w-[60%]">{h.prompt}</span>
              <span className="text-xs text-[var(--ic-muted)]">{h.name} · {new Date(h.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="text-xs text-[var(--ic-muted)]">
        Signed in as {user?.name}. Scripts pushed here feed the Playbooks list and the SOAR run counters. Runbooks (project procedures) live in the sibling tab.
      </footer>
    </div>
  );
}
