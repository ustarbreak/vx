# Analytics (`analytics`)

Status: **ga** · Provider: `native` · Engine: `Grafana + OpenSearch/Loki` · In seed registry: True

## What it is
Generated from the platform catalog (`backend/app/platform/catalog/analytics.yaml`).
Do not edit by hand — regenerate with `python backend/tools/gen_docs.py`.

## Dependencies
- requires `network-monitoring` (Le flux d'événements analysés par Security Analytics provient des collecteurs Network Monitoring (NMS).)

## Install
MVP engines (Wazuh, MISP, DFIR-IRIS): see `docs/guides/CONNECTOR-INSTALL.md`
and `deploy/install.sh --service analytics` (compose profiles per owner decision #2/#8).
Other services: manual install, then register connection in the admin UI
(org-scoped via `org_id`, owner decision #3). TODO_VERIFY: image pins checked
on first real install only.

## Capabilities (canonical actions)
| action | gating | status |
|---|---|---|
| _(no actions yet)_ | | |

## Verify
After install: `GET /api/services/analytics/status` and `/api/services/analytics/live`
must report reachable before the checklist marks *connected*. First-success
criteria live in the corresponding `deploy/<engine>/verify.sh` when shipped.
