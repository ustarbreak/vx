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
  milestones: { id: number; title: string; done: boolean }[];
}

const M = (id: number, title: string, done = false) => ({ id, title, done });

export const demoProjects: DemoProject[] = [
  // ---- OUR projects (platform side, "avec nous") --------------------------
  {
    id: 101, org_id: 1, name: 'Déploiement SOC managé Damanecash',
    description: 'Mise en service complète du SOC : collecte Wazuh, corrélations SIEM, playbooks SOAR et habilitation des techniciens.',
    kind: 'internal', status: 'active', priority: 'critical',
    manager_email: 'y.elamrani@damanecash.ma', ticket_category: 'soc-damanecash',
    sla_hours: 480, time_spent_seconds: 1_512_000, timer_running: true,
    created_by: 'admin@infracentra.io',
    milestones: [M(1, 'Audit périmètre & inventaire', true), M(2, 'Déploiement collecteurs (12 assets)', true), M(3, 'Règles de corrélation & triage IA', true), M(4, 'Playbooks isolation/blocage', false), M(5, 'Recette RSSI & go-live', false)],
  },
  {
    id: 102, org_id: 2, name: 'Migration SD-WAN + Firewall Valoris System',
    description: 'Remplacement des liens MPLS par le SD-WAN Infracentra et centralisation des politiques firewall (Casablanca, Tanger, Rabat DC).',
    kind: 'internal', status: 'active', priority: 'high',
    manager_email: 'k.chraibi@valorissystem.ma', ticket_category: 'sdwan-valoris',
    sla_hours: 720, time_spent_seconds: 971_000, timer_running: false,
    created_by: 'admin@infracentra.io',
    milestones: [M(6, 'Cartographie des sites', true), M(7, 'Overlay SD-WAN Casa–Tanger', true), M(8, 'Baseline firewall Rabat DC', false), M(9, 'Bascule pilote + rollback plan', false), M(10, 'SLA monitoring & clôture', false)],
  },
  {
    id: 103, org_id: 3, name: 'Campagne patching Q4 Vivalis Salaf',
    description: 'Patching mensuel des endpoints et serveurs critiques (Marrakech), rapport de conformité post-campagne.',
    kind: 'internal', status: 'planned', priority: 'medium',
    manager_email: 'h.tazi@vivalissalaf.ma', ticket_category: 'patching-vivalis',
    sla_hours: 160, time_spent_seconds: 0, timer_running: false,
    created_by: 'admin@infracentra.io',
    milestones: [M(11, 'Scan pré-campagne', false), M(12, 'Vague serveurs', false), M(13, 'Vague endpoints', false), M(14, 'Rapport post-campagne', false)],
  },
  // ---- CLIENT-side projects (their own, managed in our platform) ----------
  {
    id: 201, org_id: 1, name: 'Refonte portail client (avec prestataire externe)',
    description: 'Projet interne Damanecash suivi dans Infracentra : avancement, risques et tickets associés.',
    kind: 'client', status: 'active', priority: 'medium',
    manager_email: 'n.benali@damanecash.ma', ticket_category: 'portal-damanecash',
    sla_hours: 0, time_spent_seconds: 302_400, timer_running: false,
    created_by: 'demo@infracentra.io',
    milestones: [M(15, 'Cahier des charges', true), M(16, 'Maquettes UX', true), M(17, 'Intégration API paiement', false), M(18, 'Tests & mise en prod', false)],
  },
  {
    id: 202, org_id: 2, name: 'Certification ISO 27001 (Valoris System)',
    description: 'Préparation à la certification : gap analysis, remédiation, audit blanc.',
    kind: 'client', status: 'on_hold', priority: 'high',
    manager_email: 'a.fassi@valorissystem.ma', ticket_category: 'iso-valoris',
    sla_hours: 1200, time_spent_seconds: 1_036_800, timer_running: false,
    created_by: 'soc@valorissystem.ma',
    milestones: [M(19, 'Gap analysis', true), M(20, 'Plan de remédiation', true), M(21, 'Sensibilisation équipes', false), M(22, 'Audit blanc', false), M(23, 'Audit de certification', false)],
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
