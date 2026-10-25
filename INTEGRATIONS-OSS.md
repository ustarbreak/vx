# Intégrations open-source — tous les services en données réelles

Depuis Threat Intelligence a été le premier service câblé sur du vrai backend
(MISP + AlienVault OTX). **Désormais les 16 services + Advanced Ticketing ont
tous un connecteur réel** vers la meilleure solution open source qui leur
correspond. Le code est installé par défaut (`backend/app/services/connectors.py`),
activé uniquement quand **Demo Mode = OFF**.

## 1. Mapping service → moteur open source

| Service (id) | Moteur OSS par défaut | Ce qui est récupéré en live |
|---|---|---|
| threat-intel | MISP + AlienVault OTX | IOCs, événements, sévérités |
| compliance | Wazuh SCA / CIS-CAT Lite | états des scans de configuration |
| incident-response | TheHive | cases/cas d'incidents |
| analytics | Grafana + OpenSearch/Loki | dashboards, santé, logs agrégés |
| soar | n8n / Shuffle | workflows + exécutions |
| vuln-scanning | OpenVAS (Greenbone CE) | tâches & résultats de scan |
| patch-management | Fleet (osquery) | hosts & conformité patches |
| backup-dr | Restic / Borgmatic | snapshots & stats dépôt |
| endpoint-protection | Wazuh agents + ClamAV | agents, vulnérabilités |
| email-security | Rspamd / Mailcow | scores & stats anti-spam/DMARC |
| cloud-security | Prowler / CloudSploit | findings CSPM |
| network-monitoring | Netdata + LibreNMS | devices, CPU/débit live |
| dns-filtering | Pi-hole FTL API | stats blocages DNS |
| firewall-mgmt | OPNsense / pfSense | règles & alias firewall |
| vpn-gateway | Tailscale / OpenVPN-AS | devices & clés |
| sd-wan | LibreNMS / NetBox | devices & ports |
| advanced-ticketing | GLPI / osTicket | tickets ITSM |

Chaque moteur reste remplaçable par son équivalent commercial sans toucher au code :
seuls `api_endpoint` / `api_key` de la table `integrations` changent.

## 2. Nouvelles routes backend (démo OFF uniquement)

- `GET  /api/services/catalog` — mapping complet service→moteur
- `GET  /api/services/{id}/status` — probe santé (HTTP, latence)
- `GET  /api/services/{id}/live?limit=50` — **vrais enregistrements** du moteur
- `POST /api/services/sync` — health-check parallèle de tous les connecteurs

Règle de conception : une source absente/injoignable est **skippée proprement**
(`source: "none" | "unreachable"`), jamais de crash, jamais de fausse donnée
silencieuse — l'UI affiche un badge honnête.

## 3. Frontend

- `src/services/serviceData.ts` — client des routes ci-dessus.
- `src/hooks/useServiceLiveFeed.ts` — hook partagé (badge LIVE FEED) :
  - **Demo Mode ON** → mock instantané, zéro appel réseau.
  - **Demo Mode OFF** → tire `/api/services/{id}/live`, badge `LIVE FEED — N records from <engine>`.
- `src/hooks/useLiveFeed.ts` — `tryLiveFeed(serviceId)` : la structure des pages
  reste IDENTIQUE à celle de la mock data ; en mode réel le backend renvoie les
  vrais enregistrements déjà mappés sur cette même structure
  (`backend/app/services/normalizers.py`). Si le moteur n'est pas branché, la
  page retombe proprement sur le jeu de référence.
- **Pages câblées (16 services + Advanced Ticketing)** : Threats (MISP/OTX),
  Incidents (TheHive), Network (Netdata/LibreNMS), VulnerabilityScanning
  (OpenVAS), PatchManagement (Fleet), BackupDR (Restic), SOAR (n8n),
  CloudSecurity (Prowler), DNSFiltering (Pi-hole), FirewallManagement
  (OPNsense), VPNGateway (Tailscale), SDWAN (LibreNMS), EndpointProtection
  (Wazuh+ClamAV), EmailSecurity (Rspamd), Compliance (Wazuh SCA), Analytics
  (Grafana), AdvancedTicketing (GLPI).

## 4. Comment brancher un moteur (ex. Pi-hole)

1. Déployez l'OSS (ex. `docker run -d -p 8080:53 pihole/pihole:latest`).
2. Dans l'app (mode réel) → **Integrations** → créer une intégration :
   - `service_id` = `dns-filtering`, `status` = active,
   - `api_endpoint` = `http://IP-du-pihole`,
   - `api_key` = `user:pass` (Basic) ou `Bearer <token>` ou token simple.
3. Tester : `curl -H "Authorization: Bearer $JWT" http://127.0.0.1:8000/api/services/dns-filtering/live`
4. La page concernée passe automatiquement en badge LIVE FEED.

## 5. Lab de test rapide (Kali)

```bash
# Netdata (network-monitoring) — aucune authentification requise
docker run -d --name netdata -p 19999:19999 netdata/netdata
# n8n (soar) — générer une API key dans l'UI
docker run -d --name n8n -p 5678:5678 n8nio/n8n
```
Puis créez les intégrations correspondantes et appelez `/api/services/{id}/status`.
