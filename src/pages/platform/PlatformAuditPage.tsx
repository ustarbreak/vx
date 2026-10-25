import React, { useState } from 'react';
import { Search, Download, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { demoAuditLog } from '../../data/mockData';

// ---------------------------------------------------------------------------
// Explainability map (#6): for every audit action we show WHERE the log came
// from (origin module) and WHAT it means in plain language. Clicking a row
// opens the full entry + explanation modal. Unknown actions fall back to a
// generic description built from the entry itself — never an empty modal.
// ---------------------------------------------------------------------------
const AUDIT_EXPLAIN: Record<string, { origin: string; meaning: string }> = {
  'alert.generated':       { origin: 'Pipeline SIEM / corrélation', meaning: "Une règle de corrélation ou un collecteur a généré une nouvelle alerte de sécurité sur l'infrastructure supervisée d'un client." },
  'billing.invoice':       { origin: 'Moteur de facturation (Bundle All-in-One)', meaning: "Une facture a été calculée/émise : sièges supplémentaires, dépassement SIEM ou renouvellement du cycle (mensuel/annuel -12%)." },
  'compliance.scan':       { origin: 'Module Conformité', meaning: "Un scan de conformité (ISO 27001 / PCI-DSS / RGPD…) a été exécuté et le score du tenant a été recalculé." },
  'entitlement.updated':   { origin: 'Tenant Manager → Services (Grant)', meaning: "Un administrateur plateforme a activé ou désactivé un service pour un client — cela outrepasse les limites de son plan standard. L'action est tracée ici." },
  'playbook.executed':     { origin: 'Automation → Playbooks (SOAR)', meaning: "Un playbook d'automatisation a été déclenché (manuellement ou par une règle). Chaque step est journalisé séparément." },
  'service.access_attempt':{ origin: 'Passerelle API / contrôle d’accès', meaning: "Tentative d'accès à un service. 'blocked' = rôle ou plan insuffisant (refus côté serveur, jamais masqué)." },
  'threat.ingested':       { origin: 'Threat Intelligence Feed', meaning: "De nouveaux indicateurs de compromission (IOCs) ont été ingérés depuis le flux de renseignement sur les menaces." },
  'user.invited':          { origin: 'Team & Roles', meaning: "Un compte utilisateur a été invité sur le tenant ; email d'activation envoyé." },
  // Tenant manager additions (#3)
  'rule.created':          { origin: 'Tenant Manager → Rules', meaning: "Une règle de supervision a été créée : elle sera évaluée périodiquement et pourra ouvrir un ticket automatiquement ou notifier." },
  'rule.toggled':          { origin: 'Tenant Manager → Rules', meaning: "Activation/désactivation d'une règle existante." },
  'ticket.created_for_client': { origin: 'Tenant Manager → Créer un ticket', meaning: "Un administrateur Infracentra a ouvert un ticket pour ce client (escalade proactive avant que le client ne signale le problème)." },
  'partner.created':       { origin: 'Partner Program', meaning: "Nouveau partenaire MSP enregistré dans le programme (statut prospect/trial)." },
  'partner.updated':       { origin: 'Partner Program', meaning: "Fiche partenaire modifiée (contact, palier, statut)." },
  'partner.migrated':      { origin: 'Partner Program', meaning: "Migration de licence/partenaire effectuée (changement de plan wholesale ou de marque white-label)." },
  'partner.suspended':     { origin: 'Partner Program', meaning: "Partenaire suspendu : ses tenants end-clients restent actifs mais plus de provisioning." },
};

export default function PlatformAuditPage() {
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterOutcome, setFilterOutcome] = useState('all');
  const [selected, setSelected] = useState<(typeof demoAuditLog)[number] | null>(null);

  const filtered = demoAuditLog.filter(e => {
    const matchSearch = e.details.toLowerCase().includes(search.toLowerCase()) ||
      e.actorName.toLowerCase().includes(search.toLowerCase());
    const matchRole = filterRole === 'all' || e.actorRole === filterRole;
    const matchOutcome = filterOutcome === 'all' || e.outcome === filterOutcome;
    return matchSearch && matchRole && matchOutcome;
  });

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)]">Audit Log</h1>
          <p className="text-[var(--ic-muted)] text-sm mt-1">Complete activity trail across all organizations</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-[var(--ic-text)] text-sm hover:bg-[var(--ic-surface)] transition-colors">
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ic-muted)]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search audit entries..."
              className="w-full pl-10 pr-4 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
            />
          </div>
          <select
            value={filterRole}
            onChange={e => setFilterRole(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-text)] focus:outline-none focus:border-cyan-500/50"
          >
            <option value="all">All Roles</option>
            <option value="platform_admin">Platform Admin</option>
            <option value="client_admin">Client Admin</option>
            <option value="client_user">Client User</option>
          </select>
          <select
            value={filterOutcome}
            onChange={e => setFilterOutcome(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-text)] focus:outline-none focus:border-cyan-500/50"
          >
            <option value="all">All Outcomes</option>
            <option value="success">Success</option>
            <option value="blocked">Blocked</option>
            <option value="failure">Failure</option>
          </select>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--ic-border)]">
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Timestamp</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Actor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Action</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Details</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Outcome</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">IP</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(entry => (
                <tr key={entry.id} onClick={() => setSelected(entry)} title="Cliquer pour expliquer cette entrée"
                    className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)] transition-colors cursor-pointer">
                  <td className="px-4 py-3">
                    <span className="text-xs text-[var(--ic-muted)] font-mono">{new Date(entry.timestamp).toLocaleString()}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm text-[var(--ic-heading)]">{entry.actorName}</p>
                      <p className="text-xs text-[var(--ic-muted)]">{entry.actorRole.replace('_', ' ')}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-cyan-400 font-mono">{entry.action}</code>
                    {AUDIT_EXPLAIN[entry.action] && (
                      <p className="text-[10px] text-[var(--ic-muted)] mt-0.5 truncate max-w-[220px]">{AUDIT_EXPLAIN[entry.action].origin}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-[var(--ic-text)] max-w-md truncate">{entry.details}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`flex items-center gap-1.5 text-xs font-medium ${
                      entry.outcome === 'success' ? 'text-cyber-green' :
                      entry.outcome === 'blocked' ? 'text-cyber-red' : 'text-cyber-yellow'
                    }`}>
                      {entry.outcome === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                       entry.outcome === 'blocked' ? <XCircle className="w-3.5 h-3.5" /> :
                       <AlertTriangle className="w-3.5 h-3.5" />}
                      {entry.outcome}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-[var(--ic-muted)] font-mono">{entry.ip}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* #6 — Explainable audit entry modal */}
      {selected && (() => {
        const ex = AUDIT_EXPLAIN[selected.action];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div className="relative w-full max-w-lg bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-6 space-y-4"
                 onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <h3 className="text-lg font-bold text-[var(--ic-heading)] font-mono">{selected.action}</h3>
                <button onClick={() => setSelected(null)} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)]">✕</button>
              </div>
              <div className="space-y-2 text-sm">
                <p><span className="text-[var(--ic-muted)]">Origine :</span>{' '}
                  <b className="text-[var(--ic-heading)]">{ex?.origin ?? 'Journal système Infracentra'}</b></p>
                <p className="text-[var(--ic-text)]">{ex?.meaning ?? `Action « ${selected.action} » exécutée par ${selected.actorName} sur la ressource ${selected.resource}${selected.resourceId ? ` (${selected.resourceId})` : ''}.`}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-xl p-4">
                <div><span className="text-[var(--ic-muted)] block">Horodatage (UTC)</span>{new Date(selected.timestamp).toISOString()}</div>
                <div><span className="text-[var(--ic-muted)] block">Acteur</span>{selected.actorName} · {selected.actorRole}</div>
                <div><span className="text-[var(--ic-muted)] block">Ressource</span>{selected.resource} {selected.resourceId}</div>
                <div><span className="text-[var(--ic-muted)] block">IP source</span><code>{selected.ip}</code></div>
                <div><span className="text-[var(--ic-muted)] block">Tenant</span>{selected.orgId ?? 'plateforme'}</div>
                <div><span className="text-[var(--ic-muted)] block">Résultat</span>{selected.outcome}</div>
              </div>
              <p className="text-xs text-[var(--ic-muted)] italic border-t border-[var(--ic-border)] pt-3">
                🔒 Cette entrée est immuable (journal d'audit). Elle provient du backend FastAPI en mode réel, et du monde démo unifié en mode démo — mêmes schémas, mêmes actions.
              </p>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
