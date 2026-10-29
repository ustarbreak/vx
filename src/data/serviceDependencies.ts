// ---------------------------------------------------------------------------
// Declared platform service-dependency catalog (§6F).
//
// These are the ONLY dependency edges the Service Dependency Graph may render.
// They are a curated, human-declared table of how Infracentra platform
// services genuinely depend on one another (e.g. SOAR enrichment consumes the
// SIEM detection stream; Threat Intel distribution is enforced through DNS
// Filtering). An edge is shown for an organization ONLY when BOTH endpoints
// exist in that org's entitlement rows — the graph never invents a dependency
// between services the tenant does not have records for.
//
// `requires` lists service ids from serviceCatalog (src/data/mockData.ts) that
// must be provisioned for this service to deliver its full function. When a
// requirement is NOT entitled for the tenant, the page surfaces it honestly as
// "dépendance non provisionnée" rather than hiding it or claiming health.
// ---------------------------------------------------------------------------

export interface ServiceDependencyRule {
  /** Dependent service id (key of serviceCatalog). */
  service: string;
  /** Service ids this service relies on for full operation. */
  requires: string[];
  /** Why the edge is real — displayed as the edge evidence label. */
  rationale: string;
}

export const SERVICE_DEPENDENCY_RULES: ServiceDependencyRule[] = [
  {
    service: 'analytics', requires: ['network-monitoring'],
    rationale: 'Le flux d\u2019événements analysés par Security Analytics provient des collecteurs Network Monitoring (NMS).',
  },
  {
    service: 'threat-intel', requires: ['analytics'],
    rationale: 'Les correspondances IoC ⇄ événements sont calculées sur le pipeline de détection de Security Analytics.',
  },
  {
    service: 'incident-response', requires: ['analytics'],
    rationale: 'Les alertes corrélées par Security Analytics alimentent la file de qualification d\u2019Incident Response.',
  },
  {
    service: 'soar', requires: ['incident-response'],
    rationale: 'Les playbooks SOAR se déclenchent sur un incident qualifié et écrivent leur résultat dans le dossier IR.',
  },
  {
    service: 'soar', requires: ['threat-intel'],
    rationale: 'L\u2019enrichissement des steps SOAR (réputation, blocage) consomme les indicateurs Threat Intelligence.',
  },
  {
    service: 'endpoint-protection', requires: ['analytics'],
    rationale: 'Les événements EDR/XDR remontent au pipeline SIEM pour corrélation avec les autres sources.',
  },
  {
    service: 'email-security', requires: ['threat-intel'],
    rationale: 'Le filtrage des liens/pièces jointes compare les extraits aux indicateurs Threat Intelligence.',
  },
  {
    service: 'dns-filtering', requires: ['threat-intel'],
    rationale: 'La liste de blocage DNS est distribuée depuis les flux Threat Intelligence (canaux autorisés).',
  },
  {
    service: 'firewall-mgmt', requires: ['threat-intel'],
    rationale: 'Les règles de blocage IP poussées par Firewall Management ciblent des adresses signalées par Threat Intel.',
  },
  {
    service: 'cloud-security', requires: ['asset-discovery'],
    rationale: 'Le posture CSPM évalue uniquement les ressources identifiées par la découverte d\u2019actifs.',
  },
  {
    service: 'vuln-scanning', requires: ['asset-discovery'],
    rationale: 'Le scanneur cible l\u2019inventaire produit par la découverte automatique ; hors inventaire = hors périmètre.',
  },
  {
    service: 'patch-management', requires: ['vuln-scanning'],
    rationale: 'Les déploiements de correctifs sont priorisés par les vulnérabilités confirmées du Vulnerability Scanning.',
  },
  {
    service: 'backup-dr', requires: ['cloud-security'],
    rationale: 'Les politiques de sauvegarde DR s\u2019appliquent aux charges de travail déclarées par le posture Cloud.',
  },
  {
    service: 'compliance', requires: ['analytics'],
    rationale: 'Les preuves de contrôle (journaux conservés, temps de réponse) sont tirées des données Security Analytics.',
  },
];

/** Fast lookup: dependent service -> rules affecting it. */
export const depsFor = (serviceId: string): ServiceDependencyRule[] =>
  SERVICE_DEPENDENCY_RULES.filter(r => r.service === serviceId);
