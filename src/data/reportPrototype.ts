// Infracentra Unified Report — prototype dataset, ported 1:1 from
// infracentra-unified-report.html (constant X). Block contract per brief §5.
// This is the DEMO reference content shown when Demo Mode is ON; real mode
// reads the same block shapes from /api/v1/reports/* (Phase 2+ adapters).
import type { Block } from '../services/reportsApi';

export type ProtoGroup = [string, string, Block[]];           // [titre, intro, blocs]
export type ProtoChapter = { num: string; title: string; groups: ProtoGroup[] };

const T = (t: string, h: string[], r: Array<Array<string | number>>): Block => ['T', t, h, r];
const B = (t: string, r: Array<[string, number, string, string?]>): Block => ['B' as any, t, r as any];
const K = (r: Array<[string, string, string, any]>): Block => ['K', r];
const R = (r: Array<[string, number, string, string?]>): Block => ['R', r as any];
const M = (t: string, r: Array<[string, string]>): Block => ['M', t, r as any];
const L = (t: string, r: string[]): Block => ['L', t, r];

export const PROTO_CHAPTERS: Record<string, ProtoChapter> = {
  summary: {
    num: '01', title: 'Rapport global — Synthèse exécutive',
    groups: [
      ['KPI & tendances', 'Évolution des indicateurs sur 6 mois et comparatif période par période.', [
        K([['Événements collectés', '48,2 M', '▲ +6 %', '1'], ['Alertes / jour', '214', '▲ −11 %', '2'], ['Incidents qualifiés', '187', '▼ +9 %', 'b'], ['MTTD', '14 min', '▲ −31 %', 'o'], ['MTTR', '47 min', '▲ −18 %', 'o'], ['Automatisation', '73 %', '▲ +9 pts', '3'], ['Faux positifs', '8,4 %', '▲ −2,1 pts', 'w'], ['Score de posture', '82 /100', '▲ +6', 'o']]),
        B('Score de posture (6 mois)', [['Juin', 64, 'w'], ['Juillet', 68, 'w'], ['Août', 71, '1'], ['Septembre', 74, '1'], ['Octobre', 76, '2'], ['Novembre', 82, 'o']]),
        B('Automatisation SOAR (6 mois)', [['Juin', 48, '3'], ['Juillet', 52, '3'], ['Août', 55, '3'], ['Septembre', 58, '3'], ['Octobre', 64, '3'], ['Novembre', 73, '3']]),
        T('Comparatif mensuel', ['Mois', 'Incidents', 'MTTD', 'MTTR', 'Automatisation', 'Score'], [['Novembre', '187', '14 min', '47 min', '73 %', '82'], ['Octobre', '172', '20 min', '57 min', '64 %', '76'], ['Septembre', '165', '23 min', '61 min', '58 %', '74'], ['Août', '158', '26 min', '70 min', '55 %', '71']]),
      ]],
      ['Risques & exposition', 'Principaux risques, exposition par périmètre et faits marquants.', [
        T('Top 5 des risques', ['#', 'Risque', 'Périmètre', 'Niveau', 'Responsable', 'Échéance'], [['1', 'Angles morts IoT (12 % des actifs)', 'IoT', '@high:Élevé', '[RSSI]', '[31/12]'], ['2', 'Comptes à privilèges sans MFA', 'Serveurs', '@crit:Critique', '[DSI]', '[15/12]'], ['3', 'Stockage cloud exposé', 'Cloud', '@high:Élevé', '[CloudOps]', '[30/11]'], ['4', 'Correctifs critiques en retard', 'Endpoints', '@med:Moyen', '[IT Ops]', '[20/12]'], ['5', 'Procédure de notification non testée', 'Conformité', '@med:Moyen', '[DPO]', '[15/12]']]),
        B('Exposition par périmètre', [['Endpoints', 32, 'w'], ['Serveurs', 41, 'h'], ['Réseau', 24, 'o'], ['IoT', 58, 'b'], ['Cloud', 36, 'w'], ['SaaS', 28, 'o']]),
        M('Faits marquants', [['Mouvement latéral contenu en 22 min grâce à l’isolement automatique.', 'o'], ['Campagne de phishing ciblée neutralisée sans compromission de données.', '1'], ['Stockage cloud exposé détecté et corrigé en moins de 4 h.', 'w']]),
      ]],
      ['Conformité & plateforme', 'Aperçu des référentiels et de la santé de la plateforme.', [
        R([['RGPD', 91, 'o', '2 écarts'], ['HIPAA', 84, '1', '4 écarts'], ['PCI-DSS', 88, '2', '3 écarts'], ['ISO 27001', 79, '3', '6 écarts'], ['SOC 2', 93, 'o', '1 écart'], ['NIS2', 72, 'w', '8 écarts']]),
        B('Santé de la plateforme', [['Disponibilité', 100, 'o', '99,96 %'], ['Collecte temps réel', 98, '1', '98 %'], ['Connecteurs actifs', 98, '2', '42 / 43'], ['Stockage utilisé', 64, '3', '64 %']]),
        T('Décisions demandées à la Direction', ['Décision', 'Impact', 'Budget', 'Échéance'], [['Étendre la collecte au périmètre IoT', 'Couverture +12 pts', '[ ]', '[15/12]'], ['Généraliser le MFA sur les comptes privilégiés', 'Risque −1 niveau', '[ ]', '[15/12]'], ['Lancer la certification ISO 27001', 'Conformité', '[ ]', '[T2 2027]']]),
      ]],
    ],
  },
  soc: {
    num: '02', title: 'Rapport SOC opérationnel',
    groups: [
      ['Alertes & détection', 'Règles de corrélation, sources et qualité des détections.', [
        K([['Règles actives', '412', '▲ +18', '1'], ['Détections IA/ML', '236', '▲ +22 %', '3'], ['Bruit supprimé', '41 %', '▲ +7 pts', 'o'], ['Précision', '91,6 %', '▲ +2,1', '2']]),
        T('Top règles déclenchées', ['Règle', 'Source', 'Alertes', 'Vrais positifs', 'ATT&CK'], [['Connexion à privilèges hors horaires', 'Serveurs', '214', '88 %', 'T1078'], ['Balisage réseau périodique', 'Réseau', '163', '74 %', 'T1071'], ['Exécution de script suspect', 'Endpoints', '141', '92 %', 'T1059'], ['Création d’accès cloud anormale', 'Cloud', '97', '81 %', 'T1098'], ['Pic d’authentifications échouées', 'SaaS', '88', '69 %', 'T1110']]),
        B('Volume par source', [['Endpoints', 34, '1'], ['Serveurs', 22, '2'], ['Réseau', 19, '3'], ['Cloud', 13, 'w'], ['SaaS', 8, 'o'], ['IoT', 4, 'b']]),
      ]],
      ['Triage & files d’attente', 'Charge de travail, délais de traitement et respect des SLA.', [
        K([['Backlog', '23', '▲ −9', 'o'], ['SLA respecté', '96,4 %', '▲ +1,8', '2'], ['Temps de triage', '4,2 min', '▲ −1,1', '1'], ['Escalades N3', '12', '= stable', '3']]),
        B('Alertes traitées par niveau', [['Automatisé (SOAR)', 73, '3'], ['Niveau 1', 19, '1'], ['Niveau 2', 6, '2'], ['Niveau 3', 2, 'b']]),
        L('Enseignements', ['Réduire le bruit des scans externes par une règle de réputation.', 'Enrichir les alertes SaaS avec le contexte utilisateur.', 'Automatiser le tri des alertes de faible gravité.']),
        T('Actifs les plus alertés', ['Actif', 'Type', 'Alertes', 'Cause principale', 'Action'], [['[SRV-APP-04]', 'Serveur', '86', 'Authentifications échouées', 'Durcissement'], ['[GW-EDGE-01]', 'Pare-feu', '64', 'Scans externes', 'Règle ajustée'], ['[LAP-0231]', 'Endpoint', '41', 'Script suspect', 'Réinstallation']]),
      ]],
    ],
  },
  incidents: {
    num: '03', title: 'Rapport d’incidents majeurs',
    groups: [
      ['Fiche d’incident INC-0412', 'Analyse détaillée de l’incident critique du mois : fiche et chronologie.', [
        T('Fiche', ['Champ', 'Détail'], [['Gravité', '@crit:Critique'], ['Détection', 'Corrélation + analyse comportementale (IA/ML)'], ['Périmètre', '[SRV-AD-01], compte [svc-backup]'], ['Technique', 'Mouvement latéral (T1021)'], ['Impact', 'Aucun – contenu en 22 min'], ['Statut', 'Clôturé']]),
        T('Chronologie', ['Heure', 'Événement', 'Source', 'Action'], [['[02:14]', 'Connexion hors horaires', 'Serveurs', 'Alerte générée'], ['[02:16]', 'Accès à 5 hôtes en 4 min', 'Réseau', 'Corrélation'], ['[02:19]', 'Qualification en incident critique', 'SIEM', 'Ticket créé'], ['[02:36]', 'Isolement des hôtes, compte désactivé', 'SOAR', 'Automatique']]),
      ]],
      ['Causes & tendances', 'Répartition des incidents, délais de résolution et actions correctives.', [
        B('Incidents par catégorie', [['Phishing', 34, '1'], ['Malware', 24, '2'], ['Accès non autorisé', 18, '3'], ['Mauvaise config.', 14, 'w'], ['Fuite de données', 10, 'b']]),
        B('MTTR par gravité', [['Critique', 28, 'b', '22 min'], ['Élevée', 45, 'h', '58 min'], ['Moyenne', 70, 'w', '2,4 h'], ['Faible', 90, 'o', '6 h']]),
        T('Actions correctives', ['Action', 'Responsable', 'Échéance', 'Statut'], [['MFA sur comptes de service', '[DSI]', '[15/12]', '@med:En cours'], ['Segmentation réseau des serveurs', '[Réseau]', '[31/01]', '@inf:Planifié'], ['Rotation des secrets', '[IT Ops]', '[30/11]', '@low:Terminé']]),
      ]],
    ],
  },
  coverage: {
    num: '04', title: 'Couverture & inventaire des actifs',
    groups: [
      ['Inventaire des actifs', 'Actifs attendus, connectés et gérés, par type.', [
        K([['Actifs totaux', '3 482', '▲ +64', '1'], ['Surveillés', '92 %', '▲ +3 pts', 'o'], ['Non gérés', '268', '▲ −41', 'w'], ['Shadow IT', '17', '▼ +4', 'b']]),
        T('Inventaire par type', ['Type', 'Attendus', 'Connectés', 'Agents à jour', 'Dernier contrôle', 'Couverture'], [['Endpoints', '1 820', '1 765', '1 742', '[J-0]', '97 %'], ['Serveurs', '412', '408', '401', '[J-0]', '99 %'], ['Réseau', '186', '175', '–', '[J-0]', '94 %'], ['IoT', '540', '475', '–', '[J-1]', '88 %'], ['Cloud (A/B/C)', '398', '382', '–', '[J-0]', '96 %'], ['SaaS', '126', '115', '–', '[J-0]', '91 %']]),
      ]],
      ['Lacunes & qualité des logs', 'Angles morts et complétude des journaux collectés.', [
        B('Complétude des journaux', [['Endpoints', 98, 'o'], ['Serveurs', 97, 'o'], ['Réseau', 93, '1'], ['Cloud', 95, '2'], ['SaaS', 90, '3'], ['IoT', 76, 'w']]),
        L('Plan de couverture', ['Déployer un collecteur dédié aux caméras IoT.', 'Activer la journalisation sur 11 switchs.', 'Évaluer un connecteur pour les applications SaaS tierces.']),
        T('Angles morts', ['Périmètre', 'Actifs', 'Cause', 'Risque', 'Plan'], [['IoT – caméras', '65', 'Protocole non supporté', '@high:Élevé', 'Collecteur dédié [T1]'], ['Réseau – switchs', '11', 'Journalisation désactivée', '@med:Moyen', 'Activation [15/12]'], ['SaaS – tiers', '11', 'Connecteur manquant', '@med:Moyen', 'Évaluation [T1]']]),
      ]],
    ],
  },
  vuln: {
    num: '05', title: 'Vulnérabilités & posture cloud',
    groups: [
      ['Détail des vulnérabilités', 'Principales vulnérabilités ouvertes et répartition par périmètre.', [
        K([['Critiques', '23', '▼ +4', 'b'], ['Élevées', '74', '▲ −12', 'h'], ['Activement exploitées', '5', '▼ +2', 'b'], ['Délai moyen (crit.)', '3,2 j', '▲ −1,1', 'o']]),
        T('Top vulnérabilités', ['ID', 'Actifs', 'Gravité', 'Exploit connu', 'Correctif', 'Échéance'], [['[CVE-2026-xxxx]', '14', '@crit:Critique', 'Oui', 'Disponible', '[30/11]'], ['[CVE-2026-xxxx]', '9', '@crit:Critique', 'Oui', 'Disponible', '[30/11]'], ['[CVE-2025-xxxx]', '31', '@high:Élevée', 'Non', 'Disponible', '[15/12]'], ['[CVE-2025-xxxx]', '6', '@high:Élevée', 'Non', 'En attente éditeur', '[31/12]']]),
        B('Vulnérabilités par périmètre', [['Serveurs', 38, 'b'], ['Endpoints', 31, 'w'], ['Réseau', 18, '2'], ['Cloud', 13, '3']]),
      ]],
      ['Posture cloud & correctifs', 'Conformité des configurations cloud et respect des délais de correction.', [
        R([['Cloud A', 86, '2', '12 écarts'], ['Cloud B', 79, '3', '19 écarts'], ['Cloud C', 91, 'o', '6 écarts']]),
        T('Non-conformités cloud', ['Règle', 'Ressource', 'Cloud', 'Gravité', 'Statut'], [['Stockage public', '[bucket-xx]', 'A', '@crit:Critique', '@low:Corrigé'], ['Journalisation désactivée', '[compte-xx]', 'B', '@med:Moyen', '@med:En cours'], ['Clé d’accès non tournée', '[iam-xx]', 'C', '@med:Moyen', '@inf:Planifié']]),
        B('Respect des SLA de correction', [['Critique', 92, 'b'], ['Élevée', 88, 'h'], ['Moyenne', 81, 'w'], ['Faible', 74, 'o']]),
      ]],
    ],
  },
  threat: {
    num: '06', title: 'Threat Intelligence & Threat Hunting',
    groups: [
      ['Threat Intelligence', 'Indicateurs, techniques observées et tendances pertinentes.', [
        T('Indicateurs actifs', ['Type', 'Valeur', 'Source', 'Confiance', 'Action'], [['Domaine', '[exemple-c2.xyz]', 'Flux de renseignement', '@high:Élevée', 'Bloqué'], ['IP', '[203.0.113.x]', 'Flux de renseignement', '@med:Moyenne', 'Surveillé'], ['Hachage', '[sha256…]', 'Analyse interne', '@high:Élevée', 'Bloqué'], ['URL', '[hxxp://…]', 'Communauté', '@low:Faible', 'Surveillé']]),
        B('Techniques les plus observées', [['Hameçonnage (T1566)', 78, '1'], ['Comptes valides (T1078)', 64, '2'], ['Scripts (T1059)', 52, '3'], ['C2 web (T1071)', 41, 'w']]),
        M('Tendances sectorielles', [['Hausse des attaques sur les identités cloud.', 'b'], ['Campagnes de phishing ciblant les cadres.', 'w'], ['Exploitation rapide des failles de périmètre.', '1']]),
      ]],
      ['Hypothèses de hunting', 'Résultats des hypothèses du mois et nouvelles détections créées.', [
        T('Hypothèses', ['ID', 'Hypothèse', 'Technique', 'Résultat', 'Confiance'], [['H-01', 'Compte privilégié actif hors horaires', 'T1078', '@crit:Confirmée', 'Élevée'], ['H-02', 'Balisage C2 depuis un serveur', 'T1071', '@crit:Confirmée', 'Élevée'], ['H-03', 'Exfiltration via stockage cloud', 'T1567', '@low:Infirmée', 'Moyenne'], ['H-04', 'Persistance par tâche planifiée', 'T1053', '@low:Infirmée', 'Élevée'], ['H-05', 'Abus de jetons SaaS', 'T1528', '@med:Non concluante', 'Faible']]),
        T('Capitalisation', ['Livrable', 'Description', 'Statut'], [['Règle de corrélation', 'Connexions privilégiées hors horaires', '@low:En production'], ['Playbook', 'Blocage automatique du domaine C2', '@low:En production'], ['Enrichissement', 'Ancienneté du domaine', '@inf:En test']]),
      ]],
    ],
  },
  soar: {
    num: '07', title: 'Automatisation & réponse (SOAR)',
    groups: [
      ['Playbooks & performance', 'Playbooks exécutés, taux de succès et temps gagné.', [
        K([['Exécutions', '1 494', '▲ +14 %', '3'], ['Succès', '98,7 %', '▲ +0,6', 'o'], ['Temps moyen', '38 s', '▲ −12 s', '1'], ['Heures économisées', '212 h', '▲ +24 h', '2']]),
        T('Détail des playbooks', ['Playbook', 'Déclencheur', 'Actions', 'Exéc.', 'Succès', 'Durée'], [['Isolement d’hôte', 'Alerte critique endpoint', 'Isoler, ticket, notifier', '41', '98 %', '22 s'], ['Blocage IP / domaine', 'IOC confirmé', 'Pare-feu, liste noire', '212', '100 %', '9 s'], ['Réinitialisation de compte', 'Compte compromis', 'Désactiver, MFA, notifier', '37', '95 %', '47 s'], ['Enrichissement & ticket', 'Toute alerte', 'Contexte, score, ticket', '1 204', '99 %', '31 s']]),
        B('Temps gagné par playbook', [['Enrichissement', 100, '3', '148 h'], ['Blocage IP', 45, '1', '32 h'], ['Isolement', 25, '2', '18 h'], ['Réinitialisation', 14, 'o', '14 h']]),
      ]],
      ['Cas & intégrations', 'Gestion des cas et état des intégrations bidirectionnelles.', [
        T('Cas récents', ['Cas', 'Type', 'Assigné', 'Durée', 'Statut'], [['[CASE-2231]', 'Phishing', '[Analyste 1]', '18 min', '@low:Clos'], ['[CASE-2236]', 'Mouvement latéral', '[Analyste 2]', '22 min', '@low:Clos'], ['[CASE-2244]', 'Stockage exposé', '[Analyste 1]', '3 h 40', '@low:Clos'], ['[CASE-2251]', 'Trafic IoT suspect', '[Analyste 3]', '[en cours]', '@med:Ouvert']]),
        B('Disponibilité des intégrations', [['EDR / XDR', 100, 'o', '100 %'], ['Supervision', 100, 'o', '100 %'], ['Renseignement menaces', 99, 'o', '99 %'], ['Gestion d’incidents', 100, 'o', '100 %'], ['SIEM complémentaire', 94, 'w', '94 %'], ['Orchestration', 100, 'o', '100 %']]),
        L('Opportunités d’automatisation', ['Qualification automatique des alertes de phishing.', 'Désactivation de comptes inactifs.', 'Rapport de clôture généré automatiquement.']),
      ]],
    ],
  },
  compliance: {
    num: '08', title: 'Conformité réglementaire',
    groups: [
      ['RGPD & HIPAA', 'Contrôles techniques évalués pour chaque référentiel.', [
        T('RGPD', ['Article', 'Exigence', 'Contrôle Infracentra', 'Statut'], [['Art. 5', 'Intégrité et conservation', 'Chiffrement, rétention des journaux', '@low:Conforme'], ['Art. 30', 'Registre des traitements', 'Inventaire des actifs et flux', '@low:Conforme'], ['Art. 32', 'Sécurité du traitement', 'Détection et surveillance continue', '@low:Conforme'], ['Art. 33', 'Notification sous 72 h', 'Playbook de notification', '@med:Partiel'], ['Art. 35', 'Analyse d’impact', 'Contribution aux analyses de risques', '@low:Conforme']]),
        T('HIPAA', ['Référence', 'Exigence', 'Contrôle', 'Statut'], [['§164.308(a)(1)', 'Gestion des risques', 'Cartographie et registre de risques', '@low:Conforme'], ['§164.308(a)(6)', 'Gestion des incidents', 'Playbooks et gestion de cas', '@low:Conforme'], ['§164.312(b)', 'Contrôles d’audit', 'Collecte et conservation des journaux', '@low:Conforme'], ['§164.312(e)', 'Sécurité des transmissions', 'Chiffrement des flux', '@med:Partiel']]),
      ]],
      ['PCI-DSS, ISO 27001 & remédiation', 'Exigences de paiement, maturité ISO et plan de remédiation.', [
        T('PCI-DSS 4.0 (extraits)', ['Exigence', 'Intitulé', 'Statut'], [['1', 'Contrôles de sécurité réseau', '@low:Conforme'], ['8', 'Identification et authentification', '@med:Partiel'], ['10', 'Journalisation et surveillance', '@med:Partiel'], ['11', 'Tests de sécurité réguliers', '@low:Conforme'], ['12.10', 'Gestion des incidents', '@low:Conforme']]),
        B('Maturité ISO 27001 par domaine', [['Gouvernance', 86, '2'], ['Gestion des actifs', 78, '3'], ['Contrôle d’accès', 74, 'w'], ['Cryptographie', 90, 'o'], ['Opérations', 82, '1']]),
        T('Plan de remédiation', ['ID', 'Écart', 'Risque', 'Action', 'Échéance'], [['GAP-001', 'Test de notification 72 h', '@med:Moyen', 'Exercice [T4]', '[15/12]'], ['GAP-002', 'Revue des journaux IoT', '@high:Élevé', 'Collecteur IoT', '[31/12]'], ['GAP-003', 'MFA incomplet', '@high:Élevé', 'Déploiement', '[15/12]']]),
      ]],
    ],
  },
  platform: {
    num: '09', title: 'Santé & performance de la plateforme',
    groups: [
      ['Performance & capacité', 'Débit, ressources et état des composants de la plateforme.', [
        K([['Ingestion', '2 140 EPS', '▲ +8 %', '1'], ['Latence de collecte', '1,8 s', '▲ −0,4 s', 'o'], ['Requêtes (p95)', '1,2 s', '= stable', '2'], ['Rétention', '12 mois', '= conforme', '3']]),
        B('Utilisation des ressources', [['Calcul', 58, '1'], ['Mémoire', 66, '2'], ['Stockage', 64, '3'], ['Réseau', 41, 'o']]),
        T('État des composants', ['Composant', 'Rôle', 'Disponibilité', 'État'], [['Collecteur', 'Collecte des données', '99,98 %', '@low:OK'], ['Normalisation', 'Standardisation & enrichissement', '99,97 %', '@low:OK'], ['Moteur SIEM', 'Détection & corrélation', '99,95 %', '@low:OK'], ['Moteur SOAR', 'Orchestration & réponse', '99,96 %', '@low:OK'], ['Tableau de bord', 'Visualisation', '99,99 %', '@low:OK']]),
      ]],
      ['Sécurité & continuité', 'Contrôles de sécurité de la plateforme et résilience.', [
        K([['RTO', '[ ] h', 'Objectif [ ]', '1'], ['RPO', '[ ] min', 'Objectif [ ]', '2'], ['Test de reprise', '[JJ/MM]', '▲ Réussi', 'o'], ['Sauvegardes', '100 %', '▲ Vérifiées', 'o']]),
        T('Contrôles de sécurité', ['Contrôle', 'Description', 'Statut'], [['Chiffrement de bout en bout', 'Données en transit et au repos', '@low:Conforme'], ['Authentification forte', 'MFA sur tous les accès', '@low:Conforme'], ['Moindre privilège', 'Rôles et droits revus', '@low:Conforme'], ['Journal d’audit', 'Actions administrateurs tracées', '@low:Conforme'], ['Mises à jour', 'Correctifs de la plateforme', '@med:En cours']]),
        L('Maintenance', ['Fenêtre planifiée : [date / heure].', 'Prochaine mise à jour majeure : [version].', 'Aucun incident plateforme sur la période.']),
      ]],
    ],
  },
  roadmap: {
    num: '10', title: 'Recommandations & feuille de route',
    groups: [
      ['Plan d’action détaillé', 'Actions priorisées avec bénéfice, effort et responsable.', [
        T('Actions', ['ID', 'Action', 'Priorité', 'Bénéfice', 'Effort', 'Responsable', 'Échéance', 'Statut'], [['A-01', 'Étendre la collecte IoT', '@crit:P1', 'Couverture +12 pts', 'Moyen', '[RSSI]', '[15/12]', '@med:En cours'], ['A-02', 'MFA sur comptes privilégiés', '@crit:P1', 'Risque −1 niveau', 'Faible', '[DSI]', '[15/12]', '@med:En cours'], ['A-03', 'Corriger les vulnérabilités critiques', '@crit:P1', '23 → 0', 'Moyen', '[IT Ops]', '[30/11]', '@med:En cours'], ['A-04', 'Nouveaux playbooks phishing', '@high:P2', 'Automatisation +8 pts', 'Moyen', '[SOC]', '[31/01]', '@inf:Planifié'], ['A-05', 'Certification ISO 27001', '@low:P3', 'Conformité', 'Élevé', '[Conformité]', '[T2 2027]', '@inf:Planifié']]),
      ]],
      ['Jalons & risques résiduels', 'Avancement des chantiers et risques restant à traiter.', [
        B('Avancement des chantiers', [['Couverture IoT', 45, 'b'], ['MFA privilégié', 70, 'w'], ['Correctifs critiques', 82, 'o'], ['Playbooks phishing', 20, '2'], ['ISO 27001', 15, '3']]),
        T('Risques résiduels', ['Risque', 'Niveau actuel', 'Niveau cible', 'Mesure'], [['Angles morts IoT', '@high:Élevé', '@low:Faible', 'A-01'], ['Comptes privilégiés', '@crit:Critique', '@med:Moyen', 'A-02'], ['Conformité NIS2', '@med:Moyen', '@low:Faible', 'Plan 2027']]),
        M('Prochaines étapes', [['Comité de pilotage sécurité : [date].', 'o'], ['Revue trimestrielle des risques : [date].', '1'], ['Point conformité avec le DPO : [date].', '3']]),
      ]],
    ],
  },
};

// Prototype overview pages (hard-coded HTML sections) normalized to blocks.
export const PROTO_OVERVIEW: Record<string, ProtoGroup> = {
  summary: ['Vue d’ensemble', 'Synthèse visuelle : risque global, messages clés et KPI tendances.', [
    ['G' as any, 'Niveau de risque global : modéré · ▲ −6 pts vs mois précédent', 68, 'w'],
    M('Messages clés', [['Aucun incident critique avec impact métier sur la période.', 'o'], ['Délai de détection réduit de 31 % grâce aux nouvelles corrélations et à l’analyse IA/ML.', '1'], ['Décision requise : couvrir le périmètre IoT (12 % des actifs encore aveugles).', 'b']]),
    K([['MTTD', '14 min', '▲ −31 %', 'o'], ['MTTR', '47 min', '▲ −18 %', '2'], ['Réponses automatisées', '73 %', '▲ +9 pts', '3'], ['Faux positifs', '8,4 %', '▲ −2,1 pts', 'w'], ['Incidents critiques', '2', '▼ +1', 'b'], ['Disponibilité plateforme', '99,96 %', '= SLA 99,9 %', 'o']]),
  ]],
  soc: ['Vue d’ensemble', 'Chaîne : collecte → normalisation → SIEM → SOAR.', [
    ['F' as any, 'Chaîne de valeur SOC', [['Événements collectés', 48200000], ['Normalisés & enrichis', 38500000], ['Alertes SIEM', 6412], ['Incidents qualifiés', 187], ['Critiques', 2]]],
    ['D' as any, 'Incidents par catégorie', [['Phishing', 34, '1'], ['Malware', 24, '2'], ['Accès non autorisé', 18, '3'], ['Mauvaise configuration', 14, 'w'], ['Fuite de données', 10, 'b']]],
    B('Gravité des alertes', [['Critique', 4, 'b'], ['Élevée', 16, 'h'], ['Moyenne', 38, 'w'], ['Faible', 42, 'o']]),
  ]],
  incidents: ['Vue d’ensemble', 'Post-mortem synthétique des incidents critiques et élevés.', [
    T('Incidents majeurs', ['ID', 'Date', 'Gravité', 'Périmètre', 'Description', 'Impact', 'Statut'], [['INC-0412', '[04/11]', '@crit:Critique', 'Serveurs Windows', 'Mouvement latéral via compte privilégié', 'Aucun – contenu en 22 min', 'Clôturé'], ['INC-0431', '[12/11]', '@crit:Critique', 'SaaS messagerie', 'Campagne de phishing ciblée (cadres)', '3 comptes réinitialisés', 'Clôturé'], ['INC-0457', '[21/11]', '@high:Élevée', 'Cloud public', 'Stockage exposé publiquement', 'Aucune donnée extraite', 'Corrigé'], ['INC-0468', '[27/11]', '@med:Moyenne', 'IoT', 'Caméra communiquant avec IP malveillante', 'Isolée automatiquement', 'En cours']]),
  ]],
  coverage: ['Vue d’ensemble', 'Visibilité par périmètre : endpoints, serveurs, réseau, IoT, cloud, SaaS.', [
    B('Couverture par périmètre', [['Endpoints', 97, 'o'], ['Serveurs', 99, 'o'], ['Réseau', 94, '1'], ['IoT', 88, 'w'], ['Cloud A / B / C', 96, '2'], ['Applications SaaS', 91, '3']]),
  ]],
  vuln: ['Vue d’ensemble', 'Gestion des vulnérabilités, CSPM, exposition.', [
    ['D' as any, 'Vulnérabilités ouvertes', [['Critiques', 23, 'b'], ['Élevées', 74, 'h'], ['Moyennes', 176, 'w'], ['Faibles', 117, 'o']]],
    R([['Cloud A', 86, '2', 'score posture'], ['Cloud B', 79, '3', 'score posture'], ['Cloud C', 91, 'o', 'score posture']]),
    M('Correction', [['Délai moyen de correction critique : 3,2 jours (objectif 5).', 'o']]),
  ]],
  threat: ['Vue d’ensemble', 'Renseignement, hypothèses, découvertes.', [
    ['H' as any, 'Activité observée par tactique (cartographie ATT&CK)', [['Accès initial', 45], ['Exécution', 60], ['Persistance', 50], ['Élévation', 80], ['Mouvement latéral', 100], ['Exfiltration', 70], ['Impact', 40], ['Identifiants', 90]]],
    B('Hunts du mois', [['Hypothèses testées', 100, '1', '6'], ['Confirmées', 33, 'b', '2'], ['Infirmées', 50, 'o', '3'], ['Non concluantes', 17, 'w', '1']]),
    M('Découverte phare — FND-007', [['@Élevée Connexions sortantes périodiques d’un serveur vers un domaine récemment enregistré (balisage C2 probable). IOC : [domaine, IP, hachage] · Action : blocage automatique + nouvelle règle de corrélation.', 'h']]),
  ]],
  soar: ['Vue d’ensemble', 'Playbooks et gain opérationnel.', [
    ['G' as any, 'des incidents traités automatiquement', 73, '3'],
    T('Playbooks exécutés', ['Playbook', 'Exéc.', 'Succès'], [['Isolement d’hôte compromis', '41', '98 %'], ['Blocage d’IP / domaine', '212', '100 %'], ['Réinitialisation de compte', '37', '95 %'], ['Enrichissement & ticket', '1 204', '99 %']]),
    M('Gain', [['≈ 212 h d’analyste économisées.', 'o']]),
  ]],
  compliance: ['Vue d’ensemble', 'RGPD · HIPAA · PCI-DSS · ISO 27001 · SOC 2 · NIS2.', [
    R([['RGPD', 91, 'o', '2 écarts'], ['HIPAA', 84, '1', '4 écarts'], ['PCI-DSS 4.0', 88, '2', '3 écarts'], ['ISO 27001', 79, '3', '6 écarts'], ['SOC 2', 93, 'o', '1 écart'], ['NIS2', 72, 'w', '8 écarts']]),
    T('Principaux écarts', ['Réf.', 'Exigence', 'Écart', 'Risque', 'Échéance'], [['RGPD Art. 33', 'Notification sous 72 h', 'Procédure non testée', '@med:Moyen', '[15/12]'], ['PCI 10.4', 'Revue quotidienne des journaux', 'Partielle (IoT)', '@high:Élevé', '[31/12]']]),
    M('Avertissement', [['Ce tableau est un suivi technique, pas un avis juridique.', 'w']]),
  ]],
  platform: ['Vue d’ensemble', 'Sécurisée · Haute disponibilité · Évolutive.', [
    K([['Latence de collecte', '1,8 s', '= stable', '1'], ['Connecteurs actifs', '42 / 43', '= stable', '2'], ['Stockage utilisé', '64 %', '= conforme', '3'], ['Chiffrement de bout en bout', 'Conforme', '▲ OK', 'o']]),
  ]],
  roadmap: ['Vue d’ensemble', 'Priorisées par impact.', [
    ['C' as any, 'Feuille de route', [['Immédiat (0–30 j)', ['Étendre la collecte au périmètre IoT', 'Tester la procédure de notification 72 h', 'Corriger les 23 vulnérabilités critiques'], 'b'], ['Court terme (1–3 mois)', ['Nouveaux playbooks de phishing', 'Durcir la posture cloud B', 'Exercice de réponse à incident'], 'w'], ['Moyen terme (3–12 mois)', ['Certification ISO 27001', 'Modèles ML personnalisés par client', 'Chasse aux menaces continue'], 'o']]],
    ['P' as any, 'Signatures', ['Analyste Infracentra', 'RSSI / DPO du client', 'Direction']],
  ]],
};
