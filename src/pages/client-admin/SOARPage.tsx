import React, { useState, useEffect } from 'react';

/**
 * Guide complet "Playbooks avancés" — panneau collapsible intégré à la page SOAR.
 * Documentation en ligne pour : admins Infracentra (qui créent pour le compte du
 * client) et clients autorisés. Aucun nom d'outil interne n'apparaît.
 */
const PlaybookGuide: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-[var(--ic-surface-2)] transition">
        <span className="text-sm font-semibold text-[var(--ic-heading)]">
          📘 Guide — Créer des playbooks avancés (triggers · steps · variables)
        </span>
        <span className="text-xs text-cyan-400">{open ? 'Réduire ▲' : 'Déplier ▼'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 text-sm text-[var(--ic-text)] space-y-4 border-t border-[var(--ic-border)] pt-4">
          <section>
            <h3 className="font-bold text-[var(--ic-heading)] mb-1">1. Anatomie d'un playbook</h3>
            <p className="text-[var(--ic-muted)]">Un playbook = un <b>trigger</b> (déclencheur), une suite de <b>steps</b> (actions ordonnées) et des <b>variables</b> partagées entre steps. Chaque step peut conditionner son exécution (if/else) et définir un timeout.</p>
          </section>
          <section>
            <h3 className="font-bold text-[var(--ic-heading)] mb-1">2. Triggers disponibles</h3>
            <ul className="list-disc ml-5 space-y-1 text-[var(--ic-muted)]">
              <li><code className="text-cyan-300">alert.severity&gt;=high</code> — se déclenche sur toute alerte critique (ex. ransomware détecté).</li>
              <li><code className="text-cyan-300">ticket.created(priority=P1)</code> — à l'ouverture d'un ticket P1 par un client.</li>
              <li><code className="text-cyan-300">device.status==offline for 5m</code> — supervision : sonde ou serveur injoignable.</li>
              <li><code className="text-cyan-300">schedule(cron)</code> — exécution planifiée (scan hebdo, rapport mensuel).</li>
              <li><code className="text-cyan-300">manual</code> — bouton Run depuis cette page (tests, remédiation ponctuelle).</li>
            </ul>
          </section>
          <section>
            <h3 className="font-bold text-[var(--ic-heading)] mb-1">3. Variables & contexte</h3>
            <p className="text-[var(--ic-muted)]">Référencez les données de l'événement avec <code className="text-cyan-300">{'{{event.host}}'}</code>, <code className="text-cyan-300">{'{{event.user}}'}</code>, <code className="text-cyan-300">{'{{ticket.id}}'}</code>, <code className="text-cyan-300">{'{{alert.signature}}'}</code>. Les steps intermédiaires exposent leur sortie via <code className="text-cyan-300">{'{{steps.<id>.output}}'}</code>.</p>
          </section>
          <section>
            <h3 className="font-bold text-[var(--ic-heading)] mb-1">4. Steps typiques (dans l'ordre recommandé)</h3>
            <ol className="list-decimal ml-5 space-y-1 text-[var(--ic-muted)]">
              <li><b>Enrichir</b> — réputation IP/hash, propriétaire du device, dernier patch.</li>
              <li><b>Vérifier</b> — ne pas agir sur un faux positif (condition <code>if confidence &lt; 80 → notify analyst</code>).</li>
              <li><b>Contenir</b> — isolation endpoint / blocage firewall, toujours <i>réversible</i>.</li>
              <li><b>Réparer</b> — déploiement correctif, reset compte, purge file d'attente.</li>
              <li><b>Documenter</b> — créer le ticket, joindre les IOCs, notifier le client (canal de ses Notification Rules).</li>
            </ol>
          </section>
          <section>
            <h3 className="font-bold text-[var(--ic-heading)] mb-1">5. Bonnes pratiques sécurité</h3>
            <ul className="list-disc ml-5 space-y-1 text-[var(--ic-muted)]">
              <li>Toujours tester en mode <b>dry-run</b> avant activation (bouton Test).</li>
              <li>Un step destructif (isolation, reboot) doit avoir un step de rollback documenté.</li>
              <li>Chaque run est journalisé dans l'Audit Trail — vérifiez « Runs récents » après mise en prod.</li>
              <li>Clients : demandez à votre admin MSP de valider tout playbook qui touche la production.</li>
            </ul>
          </section>
          <section className="bg-[var(--ic-surface-2)] rounded-lg p-3">
            <h3 className="font-bold text-[var(--ic-heading)] mb-1">Exemple complet — Otage ransomware</h3>
            <pre className="text-xs text-emerald-300 overflow-x-auto whitespace-pre">{`trigger : alert.rule == "ransomware-behavior"
step 1  enrich   : owner({{event.host}}) -> {{steps.enrich.output.owner}}
step 2  contain  : isolate_endpoint({{event.host}}) if alert.confidence >= 80
step 3  ticket   : create(priority=P1, title="Isolation auto {{event.host}}",
                          assignee={{steps.enrich.output.owner}})
step 4  notify   : channels(client rules) + mail SOC
rollback: release_endpoint({{event.host}}) — manuel via Approvals`}</pre>
          </section>
        </div>
      )}
    </div>
  );
};
import { Zap, Play, Pause, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { tryLiveFeed } from '../../hooks/useLiveFeed';

interface Playbook {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'inactive' | 'running';
  executions: number;
  lastRun?: string;
  successRate: number;
}

export default function SOARPage() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPlaybooks = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      // REAL DATA: same structure, fed by the service's open-source engine
      const live = await tryLiveFeed('soar');
      if (live) { setPlaybooks(live as any); setLoading(false); return; }
      setPlaybooks([
        { id: 'PB-001', name: 'Ransomware Response', description: 'Automated response to ransomware detection', status: 'active', executions: 145, lastRun: '2027-01-15T08:30:00Z', successRate: 98 },
        { id: 'PB-002', name: 'Phishing Investigation', description: 'Investigate and remediate phishing attempts', status: 'active', executions: 234, lastRun: '2027-01-15T09:15:00Z', successRate: 95 },
        { id: 'PB-003', name: 'Network Isolation', description: 'Isolate compromised devices from network', status: 'running', executions: 67, lastRun: '2027-01-15T09:20:00Z', successRate: 100 },
        { id: 'PB-004', name: 'User Account Lockout', description: 'Lock compromised user accounts', status: 'inactive', executions: 23, lastRun: '2027-01-10T14:00:00Z', successRate: 100 },
      ]);
      setLoading(false);
    };
    fetchPlaybooks();
  }, []);

  const stats = {
    total: playbooks.length,
    active: playbooks.filter(p => p.status === 'active').length,
    running: playbooks.filter(p => p.status === 'running').length,
    totalExecutions: playbooks.reduce((sum, p) => sum + p.executions, 0),
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[var(--ic-heading)]">SOAR Automation</h1>
        <p className="text-gray-400 mt-1">Security Orchestration, Automation and Response</p>
      </div>

      {/* ---- Guide Playbooks Avancés (collapsible) — admin plateforme ou client ---- */}
      <PlaybookGuide />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Zap className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Playbooks</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.active}</span>
          </div>
          <p className="text-gray-400 text-sm">Active</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Play className="w-6 h-6 text-yellow-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.running}</span>
          </div>
          <p className="text-gray-400 text-sm">Running</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Clock className="w-6 h-6 text-purple-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.totalExecutions}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Executions</p>
        </div>
      </div>

      <div className="bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--ic-border)] bg-[var(--ic-surface)]">
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Playbook</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Description</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Executions</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Success Rate</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Last Run</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {playbooks.map((playbook) => (
              <tr key={playbook.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)]">
                <td className="py-3 px-4 text-[var(--ic-heading)] font-medium">{playbook.name}</td>
                <td className="py-3 px-4 text-gray-400 text-sm">{playbook.description}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    playbook.status === 'active' ? 'bg-green-500/20 text-green-400' :
                    playbook.status === 'running' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400'
                  }`}>{playbook.status}</span>
                </td>
                <td className="py-3 px-4 text-gray-300">{playbook.executions}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <div className="w-16 bg-[var(--ic-surface)] rounded-full h-2">
                      <div className={`h-2 rounded-full ${playbook.successRate >= 95 ? 'bg-green-500' : playbook.successRate >= 80 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${playbook.successRate}%` }} />
                    </div>
                    <span className="text-gray-300 text-sm">{playbook.successRate}%</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-gray-400 text-sm">{playbook.lastRun ? new Date(playbook.lastRun).toLocaleString() : 'Never'}</td>
                <td className="py-3 px-4">
                  <button className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-[var(--ic-heading)] rounded text-sm">Execute</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
