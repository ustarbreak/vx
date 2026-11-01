# Threat Intel (`threat-intel`)

Status: **ga** · Provider: `native` · Engine: `MISP + AlienVault OTX` · In seed registry: True

## What it is
Generated from the platform catalog (`backend/app/platform/catalog/threat-intel.yaml`).
Do not edit by hand — regenerate with `python backend/tools/gen_docs.py`.

## Dependencies
- requires `analytics` (Les correspondances IoC ⇄ événements sont calculées sur le pipeline de détection de Security Analytics.)

## Install
MVP engines (Wazuh, MISP, DFIR-IRIS): see `docs/guides/CONNECTOR-INSTALL.md`
and `deploy/install.sh --service threat-intel` (compose profiles per owner decision #2/#8).
Other services: manual install, then register connection in the admin UI
(org-scoped via `org_id`, owner decision #3). TODO_VERIFY: image pins checked
on first real install only.

## Capabilities (canonical actions)
| action | gating | status |
|---|---|---|
| _(no actions yet)_ | | |

## Verify
After install: `GET /api/services/threat-intel/status` and `/api/services/threat-intel/live`
must report reachable before the checklist marks *connected*. First-success
criteria live in the corresponding `deploy/<engine>/verify.sh` when shipped.
