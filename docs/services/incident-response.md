# Incident Response (`incident-response`)

Status: **ga** · Provider: `native` · Engine: `TheHive (SOAR-ready case management)` · In seed registry: True

## What it is
Generated from the platform catalog (`backend/app/platform/catalog/incident-response.yaml`).
Do not edit by hand — regenerate with `python backend/tools/gen_docs.py`.

## Dependencies
- requires `analytics` (Les alertes corrélées par Security Analytics alimentent la file de qualification d'Incident Response.)

## Install
MVP engines (Wazuh, MISP, DFIR-IRIS): see `docs/guides/CONNECTOR-INSTALL.md`
and `deploy/install.sh --service incident-response` (compose profiles per owner decision #2/#8).
Other services: manual install, then register connection in the admin UI
(org-scoped via `org_id`, owner decision #3). TODO_VERIFY: image pins checked
on first real install only.

## Capabilities (canonical actions)
| action | gating | status |
|---|---|---|
| incident.create | safe | GA (live in this app) |
| incident.status | safe | GA (live in this app) |

## Verify
After install: `GET /api/services/incident-response/status` and `/api/services/incident-response/live`
must report reachable before the checklist marks *connected*. First-success
criteria live in the corresponding `deploy/<engine>/verify.sh` when shipped.
