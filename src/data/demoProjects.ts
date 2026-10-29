// ---------------------------------------------------------------------------
// Demo Project Manager world — synchronised with demoWorld.ts (same tenants,
// same technicians, same devices). Used ONLY in Demo Mode.
//
// Two different structures, mirroring the real backend rules:
//  * kind 'internal' → OUR projects delivered WITH a client (Damanecash /
//    Valoris System / Vivalis Salaf). Owned by the platform team; visible to
//    the platform admin AND to that client on his side ("with us").
//  * kind 'client'   → the client's OWN projects (managed in our platform,
//    possibly with HIS clients). Never visible on the platform-admin side
//    list unless the client shares them; here we keep them client-side only.
// ---------------------------------------------------------------------------

export interface DemoProject {
  id: number;
  org_id: number;              // tenant the project belongs to
  name: string;
  description: string;
  kind: 'internal' | 'client'; // internal = avec nous ; client = leur projet propre
  status: 'planned' | 'active' | 'on_hold' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  manager_email: string;       // technician from demoWorld
  ticket_category: string;     // link to tickets category
  sla_hours: number;
  time_spent_seconds: number;
  timer_running: boolean;
  created_by: string;
  milestones: { id: number; title: string; done: boolean; planned_at?: string | null }[];
}

// Deterministic demo milestone. `planned` is an ISO date string or null —
// null deliberately exercises the "no planned date" honest state of the
// Gantt timeline (§6G). Never randomised: demo scenarios must be stable.
const M = (id: number, title: string, done = false, planned: string | null = null) =>
  ({ id, title, done, planned_at: planned });

export const demoProjects: DemoProject[] = [
  // ---- OUR projects (platform side, "avec nous") --------------------------
  {
    id: 101, org_id: 1, name: 'Déploiement SOC managé Damanecash',
    description: 'Mise en service complète du SOC : collecte Wazuh, corrélations SIEM, playbooks SOAR et habilitation des techniciens.',
    kind: 'internal', status: 'active', priority: 'critical',
    manager_email: 'y.elamrani@damanecash.ma', ticket_category: 'soc-damanecash',
    sla_hours: 480, time_spent_seconds: 1_512_000, timer_running: true,
    created_by: 'admin@infracentra.io',
    milestones: [M(1, 'Audit périmètre & inventaire', true, '2026-08-10T09:00:00Z'), M(2, 'Déploiement collecteurs (12 assets)', true, '2026-08-31T09:00:00Z'), M(3, 'Règles de corrélation & triage IA', true, '2026-09-21T09:00:00Z'), M(4, 'Playbooks isolation/blocage', false, '2026-10-19T09:00:00Z'), M(5, 'Recette RSSI & go-live', false, '2026-11-09T09:00:00Z')],
  },
  {
    id: 102, org_id: 2, name: 'Migration SD-WAN + Firewall Valoris System',
    description: 'Remplacement des liens MPLS par le SD-WAN Infracentra et centralisation des politiques firewall (Casablanca, Tanger, Rabat DC).',
    kind: 'internal', status: 'active', priority: 'high',
    manager_email: 'k.chraibi@valorissystem.ma', ticket_category: 'sdwan-valoris',
    sla_hours: 720, time_spent_seconds: 971_000, timer_running: false,
    created_by: 'admin@infracentra.io',
    milestones: [M(6, 'Cartographie des sites', true, '2026-09-05T09:00:00Z'), M(7, 'Overlay SD-WAN Casa–Tanger', true, '2026-09-26T09:00:00Z'), M(8, 'Baseline firewall Rabat DC', false, '2026-10-12T09:00:00Z'), M(9, 'Bascule pilote + rollback plan', false, null), M(10, 'SLA monitoring & clôture', false, '2026-12-07T09:00:00Z')],
  },
  {
    id: 103, org_id: 3, name: 'Campagne patching Q4 Vivalis Salaf',
    description: 'Patching mensuel des endpoints et serveurs critiques (Marrakech), rapport de conformité post-campagne.',
    kind: 'internal', status: 'planned', priority: 'medium',
    manager_email: 'h.tazi@vivalissalaf.ma', ticket_category: 'patching-vivalis',
    sla_hours: 160, time_spent_seconds: 0, timer_running: false,
    created_by: 'admin@infracentra.io',
    milestones: [M(11, 'Scan pré-campagne', false, '2026-11-02T09:00:00Z'), M(12, 'Vague serveurs', false, '2026-11-09T09:00:00Z'), M(13, 'Vague endpoints', false, null), M(14, 'Rapport post-campagne', false, '2026-11-30T09:00:00Z')],
  },
  // ---- CLIENT-side projects (their own, managed in our platform) ----------
  {
    id: 201, org_id: 1, name: 'Refonte portail client (avec prestataire externe)',
    description: 'Projet interne Damanecash suivi dans Infracentra : avancement, risques et tickets associés.',
    kind: 'client', status: 'active', priority: 'medium',
    manager_email: 'n.benali@damanecash.ma', ticket_category: 'portal-damanecash',
    sla_hours: 0, time_spent_seconds: 302_400, timer_running: false,
    created_by: 'demo@infracentra.io',
    milestones: [M(15, 'Cahier des charges', true, '2026-07-15T09:00:00Z'), M(16, 'Maquettes UX', true, '2026-08-19T09:00:00Z'), M(17, 'Intégration API paiement', false, null), M(18, 'Tests & mise en prod', false, '2026-12-15T09:00:00Z')],
  },
  {
    id: 202, org_id: 2, name: 'Certification ISO 27001 (Valoris System)',
    description: 'Préparation à la certification : gap analysis, remédiation, audit blanc.',
    kind: 'client', status: 'on_hold', priority: 'high',
    manager_email: 'a.fassi@valorissystem.ma', ticket_category: 'iso-valoris',
    sla_hours: 1200, time_spent_seconds: 1_036_800, timer_running: false,
    created_by: 'soc@valorissystem.ma',
    milestones: [M(19, 'Gap analysis', true, '2026-06-30T09:00:00Z'), M(20, 'Plan de remédiation', true, '2026-08-04T09:00:00Z'), M(21, 'Sensibilisation équipes', false, '2026-09-15T09:00:00Z'), M(22, 'Audit blanc', false, null), M(23, 'Audit de certification', false, null)],
  },
];

/** Projects visible to a given user context (mirrors backend _scope rules). */
export function projectsForUser(role: string | undefined, orgId: number | null): DemoProject[] {
  if (role === 'platform_admin') return demoProjects.filter(p => p.kind === 'internal');
  return demoProjects.filter(p => p.org_id === orgId);
}

export function projectProgress(p: DemoProject): number {
  if (!p.milestones.length) return p.status === 'completed' ? 100 : 0;
  return Math.round(100 * p.milestones.filter(m => m.done).length / p.milestones.length);
}
