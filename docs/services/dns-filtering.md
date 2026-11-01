# Dns Filtering (`dns-filtering`)

Status: **beta** · Provider: `native` · Engine: `Pi-hole FTL API` · In seed registry: True

## What it is
Generated from the platform catalog (`backend/app/platform/catalog/dns-filtering.yaml`).
Do not edit by hand — regenerate with `python backend/tools/gen_docs.py`.

## Dependencies
- requires `threat-intel` (La liste de blocage DNS est distribuée depuis les flux Threat Intelligence (canaux autorisés).)

## Install
MVP engines (Wazuh, MISP, DFIR-IRIS): see `docs/guides/CONNECTOR-INSTALL.md`
and `deploy/install.sh --service dns-filtering` (compose profiles per owner decision #2/#8).
Other services: manual install, then register connection in the admin UI
(org-scoped via `org_id`, owner decision #3). TODO_VERIFY: image pins checked
on first real install only.

## Capabilities (canonical actions)
| action | gating | status |
|---|---|---|
| _(no actions yet)_ | | |

## Verify
After install: `GET /api/services/dns-filtering/status` and `/api/services/dns-filtering/live`
must report reachable before the checklist marks *connected*. First-success
criteria live in the corresponding `deploy/<engine>/verify.sh` when shipped.
