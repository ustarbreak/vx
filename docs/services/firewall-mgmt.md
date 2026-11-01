# Firewall Mgmt (`firewall-mgmt`)

Status: **ga** · Provider: `native` · Engine: `OPNsense / pfSense REST plugin` · In seed registry: True

## What it is
Generated from the platform catalog (`backend/app/platform/catalog/firewall-mgmt.yaml`).
Do not edit by hand — regenerate with `python backend/tools/gen_docs.py`.

## Dependencies
- requires `threat-intel` (Les règles de blocage IP poussées par Firewall Management ciblent des adresses signalées par Threat Intel.)

## Install
MVP engines (Wazuh, MISP, DFIR-IRIS): see `docs/guides/CONNECTOR-INSTALL.md`
and `deploy/install.sh --service firewall-mgmt` (compose profiles per owner decision #2/#8).
Other services: manual install, then register connection in the admin UI
(org-scoped via `org_id`, owner decision #3). TODO_VERIFY: image pins checked
on first real install only.

## Capabilities (canonical actions)
| action | gating | status |
|---|---|---|
| _(no actions yet)_ | | |

## Verify
After install: `GET /api/services/firewall-mgmt/status` and `/api/services/firewall-mgmt/live`
must report reachable before the checklist marks *connected*. First-success
criteria live in the corresponding `deploy/<engine>/verify.sh` when shipped.
