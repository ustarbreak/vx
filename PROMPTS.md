# INFRAvx — Bibliothèque de prompts de documentation
> Mode d'emploi : ouvrez Claude Opus 4.x (ou GPT-5), collez d'abord `ARCHITECTURE-MAP.md` comme contexte ("Voici l'architecture de mon projet"), puis envoyez UN prompt ci-dessous. Chaque prompt produit un livrable complet. Numérotation = ordre de production conseillé.

---

## DOC PUBLIQUE (site, prospects)
### Prompt D1 — Brochure solution publique
"Rédige la documentation publique de la plateforme INFRAvx/Infracentra (contexte fourni). Ton : professionnel B2B, orienté bénéfices. Interdictions ABSOLUES : citer un quelconque outil sous-jacent (MISP, Wazuh, TheHive, n8n, Netdata, Pi-hole, OPNsense…). Utilise uniquement des catégories : 'integration EDR/XDR', 'supervision', 'renseignement sur les menaces'. Structure : 1) Pitch 150 mots 2) Problème/solution 3) Les 16 services + ticketing avancé décrits en bénéfices métier 4) Architecture logique (collecte→normalisation IA→SIEM→SOAR→dashboards) en schéma texte 5) Modes de déploiement Hybride/Cloud/On-premise 6) Pay-per-seat et conformité RGPD/ISO 27001 7) FAQ prospects. Longueur : 2500 mots. Français."

### Prompt D2 — Guide démarrage client (onboarding)
"À partir de l'ARCHITECTURE-MAP fournie, rédige le guide de démarrage rapide d'un ADMIN CLIENT (ex : admin@damanecash.ma) : première connexion (mode démo vs réel), activer la MFA TOTP, inviter son équipe (Team & Roles), pousser le dataset démo pour évaluer, configurer l'auto-découverte SNMP (Scan Parameters → credentials → add-to-monitored), créer son premier ticket avec pièce jointe, suivre un projet (config SLA, timers, jalons), lire un rapport PDF/CSV, comprendre ses notifications (cloche, ack, retry). Format : étapes numérotées + captures décrites + encadrés 'Note' et 'Astuce'. Aucun nom d'outil interne. 2000 mots, français."

### Prompt D3 — Guide Partenaire MSP
"Rédige le guide complet du portail PARTENAIRE (route /partner/*) pour un MSP qui revend notre solution sous sa marque : inscription et validation, Tableau de bord, My Clients (créer un end-client = provisionnement tenant), Licensing & Usage (comprendre le calcul HT sièges×prix×remise, zéro frais cachés), Branding & Domain (uploader logo, configurer CNAME/enregistrements DNS, vérifier le domaine), Team & Training (planifier une session lab Teams/Zoom/Meet, modules certifiants), Value & Loyalty (scorecard canal, paliers Silver/Gold/Platinum, récompenses), Settings (profil, 2FA, password manager/reset par email). Ton : business-oriented. 2500 mots, français."

---

## DOC INTERNE OWNER (vous)
### Prompt D4 — Manuel maintenance & troubleshooting Owner
"Agis comme SRE senior. À partir de l'ARCHITECTURE-MAP, écris mon manuel de MAINTENANCE PROPRIÉTAIRE : 1) Démarrage/arrêt propre (start.bat, start-fullstack.bat, start-kali.sh, docker compose logs) 2) Santé système (vérifier API :8000, Postgres, jobs H/J/M, workers notifications) 3) Procédures pannes courantes : ECONNREFUSED proxy Vite, 'vite not recognized' (node_modules corrompu → rm -rf node_modules package-lock.json && npm install), fenêtre .bat qui se ferme (start-verbose.bat + demo-launch.log), erreur SQLite/Postgres migration (alembic upgrade head), emails/webhooks dead letters (retry-failed), MFA perdu (reset TOTP admin) 4) Sauvegarde/restauration DB + politique rétention 5) Rotation des secrets/intégrations 6) Monitoring de la plateforme elle-même. Chaque procédure : symptom → diagnostic → fix → vérification. 3000 mots, français."

### Prompt D5 — Documentation code "page par page" (PARTIEL — relancer section par section)
"J'ai la liste des pages dans l'ARCHITECTURE-MAP §5. Pour CHAQUE page de la SECTION [COLLER : ex. 'Service Desk & Ticketing'], produis une fiche : a) chemin composant exact b) route hash c) endpoints réels utilisés + payload d) point d'interception démo dans demoMode.ts e) où modifier le TEXTE des boutons f) où AJOUTER un bouton (pattern JSX existant + handler) g) où SUPPRIMER une fonctionnalité sans casser les imports h) dépendances (hooks, contexts) i) tests manuels de non-régression. Utilise le code que je te colle en pièce jointe. Markdown, tableaux."
(Sections suggérées à faire une par une : Landing · Dashboard · SOC (alerts/threat/incidents) · Ticketing · Automation · Projects · Asset Inventory · Services 16 · Reporting · Settings client · Platform Admin · Partner Portal.)

### Prompt D6 — Map des routes & anti-boutons-morts
"Analyse App.tsx, Layout.tsx et toutes les pages que je te fournis. Produis : 1) inventaire exhaustif route→composant→fichier 2) liste de TOUS les boutons/liens avec destination réelle, href='#' vide, ou onClick absent 3) pour chaque lien mort : recommandation (créer contenu, rediriger vers X, ou supprimer) 4) matrice RBAC : quelle route est accessible à quel rôle, écarts détectés. Tableaux Markdown."

---

## DOC SÉCURITÉ / CONFORMITÉ
### Prompt D7 — Dossier sécurité pour RSSI client (pré-vente)
"Rédige le security dossier de la plateforme pour rassurer un RSSI (secteur finance/santé Maroc) : architecture zero-inbound (collector → HTTPS sortant only), chiffrement AES-256 au repos/TLS1.3 transit, isolation multi-tenant par JWT (le tenant ne vient jamais d'un paramètre navigateur), bcrypt+TOTP MFA, RBAC détaillé, audit trail immuable + hash des exports, rétention et résidence des données (choix hybrid/on-prem), réponse à incident et SLA support, conformité RGPD/loi 09-08, ISO 27001/SOC2/NIS2/PCI-DSS mapping par module. Ne cite AUCUN outil interne. 2000 mots, français, format prêt à envoyer en PDF."

### Prompt D8 — Matrice RBAC officielle
"À partir de l'ARCHITECTURE-MAP §3 et du code AuthContext/Layout que je fournis, génère la matrice rôles×ressources×actions (CRUD + export + admin) pour platform_admin, partner_admin, client_admin, technician L1/L2/L3, analyst, viewer. Signale toute incohérence entre UI et API."

---

## DOC TECHNIQUE INTÉGRATIONS
### Prompt D9 — Playbook d'intégration par catégorie (version cliente anonymisée)
"Pour chacune des catégories de services (EDR/XDR, supervision, renseignement menaces, gestion incidents, orchestration, sauvegarde, messagerie, cloud, réseau…), rédige la fiche d'intégration côté CLIENT : prérequis réseau, credentials nécessaires (API key/user-pass/basic), ports sortants, temps d'onboarding, vérification santé (badge LIVE FEED), cas d'échec et fallback. Les outils internes sont masqués derrière des variables génériques {INTEGRATION_ENDPOINT}, {TOKEN}. 12 fiches."

### Prompt D10 — Runbook déploiement distant sans déplacement
"Rédige la procédure d'installation à distance chez un client éloigné : préparation clé USB autoinstall Ubuntu + Docker, enrollment via one-time key, configuration SNMP v3 des équipements, vérification remontée collector, activation des services achetés depuis le dashboard partenaire/plateforme, checklist livraison signée. Version Kali et version Windows pour l'équipe interne."

---

## ORDRE DE PRODUCTION CONSEILLÉ
D1 → D7 → D2 → D3 → D4 → D5 (x12 sections) → D6 → D9 → D10 → D8.
Chaque livrable généré s'ajoute dans `docs/` : `docs/public/`, `docs/internal/`, `docs/clients/`, `docs/partners/`, `docs/security/`.
