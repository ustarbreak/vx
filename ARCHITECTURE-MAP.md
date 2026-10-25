# INFRAvx / Infracentra — ARCHITECTURE MAP (v2026.10-3)
> Carte technique globale du projet. À fournir comme contexte à tout modèle IA (Claude Opus 4.x, GPT-5) avant de rédiger une documentation.

## 1. Vue d'ensemble
Plateforme unifiée cybersécurité + infrastructure, multi-tenant, avec séparation stricte :
- **DEMO MODE** : 100 % client-side (aucun réseau). Source unique de vérité : `src/data/demoWorld.ts`.
- **REAL MODE** : Front React → proxy Vite `/api` → Backend FastAPI → PostgreSQL.
Le mode démo intercepte les appels API avant toute requête réseau (`demoMode.ts`). En mode réel, si une source est absente : badge honnête "Donnée indisponible", jamais de fausse donnée.

## 2. Dépôt & dossiers
```
workspace (2)/
├── src/                      # Frontend React + TypeScript + Vite
│   ├── pages/                # ~60 écrans (voir §5)
│   │   ├── client-admin/     # Portail client (ticketing, PSA, devices, settings…)
│   │   ├── platform-admin/   # Portail owner (tenants, partners, seed demo…)
│   │   ├── partner/          # Portail MSP white-label (6 pages)
│   │   └── landing/…         # Site public
│   ├── components/           # Layout.tsx (sidebar+topbar), CommandPalette, NotificationBell…
│   ├── services/             # api.ts (fetch central), demoMode.ts (mock backend), reportsApi.ts, projectsApi.ts, ticketAttachments…
│   ├── data/                 # demoWorld.ts (MONDE DÉMO UNIQUE), mockData.ts (dérivé), reportPrototype.ts (20 rapports/62 pages)
│   ├── hooks/                # useServiceLiveFeed.ts, useLiveFeed.ts (badge LIVE FEED)
│   └── context/              # AuthContext.tsx (JWT + rôle + orgId)
├── backend/                  # FastAPI (Python 3.11)
│   ├── app/main.py           # Montage des routers
│   ├── app/routers/          # auth, tickets, alerts, notifications, playbooks, projects, services, settings, reports, partner, attachments
│   ├── app/services/         # connectors.py (17 adaptateurs OSS), normalizers.py, threat_intel.py (MISP/OTX), value_engine.py (6 mécaniques ROI), report builders
│   ├── app/models/           # SQLAlchemy (tenant_id partout, UTC, bcrypt)
│   └── migrations/           # Alembic
├── docs/                     # reporting/AUDIT.md, NAVIGATION-MIGRATION.md, integrations/
├── INTEGRATIONS-OSS.md       # mapping services ↔ solutions open source
├── start.bat / start-fullstack.bat / start-kali.sh   # lanceurs cross-platform
└── docker-compose.prebuilt.yml  # Postgres + API :8000
```

## 3. Rôles & accès (RBAC)
| Rôle | Route home | Voit |
|---|---|---|
| `platform_admin` | `/admin/*` | Tous tenants, Tenant Manager, Partners, Seed demo accounts, Reporting filtré par tenant |
| `partner_admin` | `/partner/*` | Seulement SES end-clients, Licensing HT détaillé, Branding/CNAME, Training+sessions live, Value&Loyalty scorecard |
| `client_admin` | `/dashboard` | Son tenant uniquement ; pas les autres clients ; pas de comptes démo dans Settings |
| `technician` / `analyst` | restreint | Tickets assignés, alertes, runbooks selon entitlements du plan |

Comptes démo marocains : admin@damanecash.ma (Pro+ticketing), soc@valorissystem.ma (Enterprise 16 services), it@vivalissalaf.ma (SME sans ticketing), ops@infracentra.io (platform), y.elamrani@atlas-cyber.ma (partner).

## 4. Flux de données
```
Collecteurs légers on-prem (SNMP v3 / Nmap / agents) 
   → HTTPS sortant unique (clé one-time enrollment)
   → Backend FastAPI /api/ingest
   → Normalisation (connectors.py + normalizers.py)
   → PostgreSQL (tables: assets, alerts, tickets, incidents, playbook_runs, projects, notifications, audit_log…)
   → Jobs agrégation H/J/M (kpi_daily, kpi_monthly)
   → API REST reporting /api/v1/reports* (isolation tenant via JWT, jamais paramètre URL)
   → Front React (pages + ReportsPage 20 rapports/62 pages, exports PDF/CSV serveur)
```

## 5. Cartographie Pages → Composants → Endpoints (extraits clés)
| Page UI | Route hash | Composant | Endpoint réel | Intercepteur démo |
|---|---|---|---|---|
| Executive Dashboard | `#/dashboard` | DashboardPage.tsx | GET /api/alerts, /api/stats | computeDemoStats() |
| Service Desk (tickets) | `#/service-desk` | AdvancedTicketingPage.tsx | /api/tickets (+attachments multipart) | demoMode tickets=TCK-01001..01012 |
| Alerts | `#/alerts` | AlertsPage.tsx | /api/alerts | mockAlerts (12, uid ALR-0001..) |
| Notifications | `#/notifications` | NotificationEnginePage.tsx | /api/notification-rules, /notifications/{id}/ack, retry-failed | moteur SMTP/Webhook/SMS simulé |
| Automation ▾ Playbooks | `#/automation/playbooks` | SOAR page | /api/playbooks | 4 playbooks demoWorld |
| Automation ▾ Scripts AI | `#/automation/scripts` | AIScriptGeneratorPage.tsx | POST /api/playbooks/generate | — |
| Automation ▾ Runbooks | `#/automation/runbooks` | AutomationRunbooksPage.tsx | POST /projects/runbooks-from-doc | New Runbook + auto-gen doc IT |
| Projects | `#/projects` | ProjectsPage.tsx | CRUD /api/projects + config + attachments | demoProjects (internal vs client) |
| Asset Inventory ▾ Auto Discovery | `#/asset-inventory/discovery` | AutoDiscoveryPage.tsx | POST /api/discovery/scan | SNMP/OID match → Add to monitored |
| Asset Inventory ▾ Scan History | `#/asset-inventory/scans` | ScanHistoryPage.tsx | GET /api/discovery/scans | |
| Asset Inventory ▾ Monitored Devices | `#/asset-inventory/devices` | MonitoredDevicesPage.tsx | GET /api/assets | 24 devices, tenant+projet affichés |
| Advanced Reporting | `#/reports` | ReportsPage.tsx | /api/v1/reports*, export pdf/csv | reportPrototype.ts |
| Settings Client | `#/settings` | SettingsPage.tsx | /api/settings/* | Demo Accounts MASQUÉ pour client_admin |
| Platform ▾ Tenant Manager | `#/admin/clients` | PlatformClientsPage.tsx | /api/organizations | member/asset counts réels |
| Platform ▾ Partners | `#/admin/partners` | PartnersManagementPage.tsx | /api/partner/* | Atlas Cyber, Oasis IT |
| Partner ▾ Dashboard/Licensing/Branding/Training/Loyalty/Settings | `#/partner/*` | 6 pages partner/ | /api/partner/* | scores déterministes |

## 6. Les 16 services + Advanced Ticketing
Catalogue `src/services/serviceData.ts` ; connecteurs OSS `backend/app/services/connectors.py` :
threat-intel→MISP/OTX · compliance→Wazuh SCA · incident-response→TheHive · analytics→Grafana · soar→n8n/Shuffle · vuln→OpenVAS · patch→Fleet/osquery · backup→Restic/Borgmatic · endpoint→Wazuh+ClamAV · email→Rspamd/Mailcow · cloud→Prowler · network→Netdata/LibreNMS · dns→Pi-hole · firewall→OPNsense · vpn→Tailscale · sd-wan→NetBox · ticketing→PostgreSQL natif (+GLPI optionnel).
Règle commerciale : ces noms n'apparaissent JAMAIS côté client (white-labeling, catégories seulement).

## 7. Séparation Démo / Réel (règle d'or)
- `api.ts` : chaque appel passe par `demoMode.handle()` si `localStorage.ic_demo_mode==='1'`.
- Le monde démo est cohérent : mêmes devices, alertes, tickets, techniciens, tenants sur TOUTES les pages (événement global `demo-world-pushed`, bouton Push Dataset dans la sidebar).
- Zéro donnée fictive en mode réel : endpoints renvoient vraies lignes SQL ou "indisponible".

## 8. Cross-platform Kali/Windows
- Chemins via `pathlib`/`os.path`, dates UTC, UTF-8, polices embarquées PDF.
- Lanceurs : `start.bat` (démo), `start-fullstack.bat` (Docker+API+front), `start-kali.sh`.
- Proxy Vite cible `127.0.0.1:8000` (jamais localhost → piège IPv6 Windows résolu).

## 9. Sécurité
JWT + bcrypt + TOTP MFA · isolation tenant via token uniquement · rate limiting · TLS · secrets via env (.env.example) · audit_log de chaque action admin/export (hash PDF).

## 10. Modèle recommandé pour la rédaction documentaire
Claude Opus 4.x (analyse de code + prose technique) ou GPT-5. Fournir ce fichier + le code source concerné + le prompt correspondant depuis PROMPTS.md.
