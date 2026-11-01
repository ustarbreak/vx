# Soar (`soar`)

Status: **ga** · Provider: `native` · Engine: `n8n / Shuffle` · In seed registry: True

## What it is
Generated from the platform catalog (`backend/app/platform/catalog/soar.yaml`).
Do not edit by hand — regenerate with `python backend/tools/gen_docs.py`.

## Dependencies
- requires `incident-response` (Les playbooks SOAR se déclenchent sur un incident qualifié et écrivent leur résultat dans le dossier IR.)
- requires `threat-intel` (L'enrichissement des steps SOAR (réputation, blocage) consomme les indicateurs Threat Intelligence.)

## Install
MVP engines (Wazuh, MISP, DFIR-IRIS): see `docs/guides/CONNECTOR-INSTALL.md`
and `deploy/install.sh --service soar` (compose profiles per owner decision #2/#8).
Other services: manual install, then register connection in the admin UI
(org-scoped via `org_id`, owner decision #3). TODO_VERIFY: image pins checked
on first real install only.

## Capabilities (canonical actions)
| action | gating | status |
|---|---|---|
| playbook.run | ⚠ dangerous | GA (live in this app) |

## Verify
After install: `GET /api/services/soar/status` and `/api/services/soar/live`
must report reachable before the checklist marks *connected*. First-success
criteria live in the corresponding `deploy/<engine>/verify.sh` when shipped.
