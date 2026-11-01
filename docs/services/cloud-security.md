# Cloud Security (`cloud-security`)

Status: **beta** · Provider: `native` · Engine: `CloudSploit / Prowler (CSPM open source)` · In seed registry: True

## What it is
Generated from the platform catalog (`backend/app/platform/catalog/cloud-security.yaml`).
Do not edit by hand — regenerate with `python backend/tools/gen_docs.py`.

## Dependencies
- requires `asset-discovery` (Le posture CSPM évalue uniquement les ressources identifiées par la découverte d'actifs.)

## Install
MVP engines (Wazuh, MISP, DFIR-IRIS): see `docs/guides/CONNECTOR-INSTALL.md`
and `deploy/install.sh --service cloud-security` (compose profiles per owner decision #2/#8).
Other services: manual install, then register connection in the admin UI
(org-scoped via `org_id`, owner decision #3). TODO_VERIFY: image pins checked
on first real install only.

## Capabilities (canonical actions)
| action | gating | status |
|---|---|---|
| _(no actions yet)_ | | |

## Verify
After install: `GET /api/services/cloud-security/status` and `/api/services/cloud-security/live`
must report reachable before the checklist marks *connected*. First-success
criteria live in the corresponding `deploy/<engine>/verify.sh` when shipped.
