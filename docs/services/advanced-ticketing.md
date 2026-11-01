# Advanced Ticketing (`advanced-ticketing`)

Status: **ga** · Provider: `native` · Engine: `GLPI / osTicket (ITSM open source)` · In seed registry: False

## What it is
Generated from the platform catalog (`backend/app/platform/catalog/advanced-ticketing.yaml`).
Do not edit by hand — regenerate with `python backend/tools/gen_docs.py`.

## Dependencies
- none

## Install
MVP engines (Wazuh, MISP, DFIR-IRIS): see `docs/guides/CONNECTOR-INSTALL.md`
and `deploy/install.sh --service advanced-ticketing` (compose profiles per owner decision #2/#8).
Other services: manual install, then register connection in the admin UI
(org-scoped via `org_id`, owner decision #3). TODO_VERIFY: image pins checked
on first real install only.

## Capabilities (canonical actions)
| action | gating | status |
|---|---|---|
| case.create | safe | GA (live in this app) |
| case.update | safe | GA (live in this app) |

## Verify
After install: `GET /api/services/advanced-ticketing/status` and `/api/services/advanced-ticketing/live`
must report reachable before the checklist marks *connected*. First-success
criteria live in the corresponding `deploy/<engine>/verify.sh` when shipped.
