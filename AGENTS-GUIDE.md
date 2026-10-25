# goinfra — Collection Agent: Complete Operating Guide

## What it is
`goinfra` is a single static Go binary installed on ONE machine per client site ("the probe").
It collects host inventory + live metrics and sweeps the local LAN (ping/portscan/SNMP/LLDP),
reporting everything to `https://app.infracentra.com` over outbound HTTPS/443 only.
**You never need to visit the client again.**

## Repository layout
| Path | Purpose |
|---|---|
| `agent-go/` | The agent source (Go 1.22+, no CGO) |
| `backend/app/routers/agent.py` | Probe API (`/api/agent/*`, token auth) + web API (`/api/agents/*`, `/api/agent-tokens`, JWT) |
| `scripts/release.sh` | Cross-compiles every platform → `backend/static/downloads/goinfra/<version>/…` |
| `scripts/downloads/install.sh` | Linux installer (served at `/downloads/goinfra/install.sh`) |
| `scripts/downloads/install.ps1` | Windows installer (served at `/downloads/goinfra/install.ps1`) |
| `src/pages/client-admin/AgentsPage.tsx` | UI: Fleet / Tokens / Discovered Devices tabs + probe drawer |

## Build & publish binaries (your server hosts them)
```bash
./scripts/release.sh 1.0.0          # from repo root, needs go >= 1.22
# produces backend/static/downloads/goinfra/1.0.0/{linux/{amd64,arm64},windows/amd64}/goinfra[.exe]
# + SHA256SUMS.txt, and copies install.sh/install.ps1 next to them
```
Then deploy the backend normally — FastAPI already mounts `/downloads` as static files,
so after deploy these URLs work:
- `https://app.infracentra.com/downloads/goinfra/install.sh`
- `https://app.infracentra.com/downloads/goinfra/install.ps1`
- `https://app.infracentra.com/downloads/goinfra/1.0.0/linux/amd64/goinfra` …

## Enroll a client (remote install, zero site visits)
1. Client admin logs into the platform → **Asset Inventory → Collection Agents**.
2. Tab **Tokens** → type a label → **New token**. The secret (`icag_…`) is shown ONCE;
   the green banner then displays ready-made one-liners with the token pre-filled:
   - **Linux (any distro):** `curl -fsSL https://app.infracentra.com/downloads/goinfra/install.sh | sudo sh -s -- --server https://app.infracentra.com --token icag_…`
   - **Windows (elevated PowerShell):** the generated `Invoke-WebRequest … install.ps1` one-liner.
   Send that line to the client by email/TeamViewer/RDP — done.
3. The installer detects OS/arch, downloads the right binary, enrolls (token stored `0600`
   in `/var/lib/goinfra` or `%ProgramData%\goinfra`), and registers autostart
   (systemd unit / SYSTEM scheduled task). Verify on the box with `goinfra status`.
4. Within ~1 minute the probe appears **Online** in the Fleet tab (auto-refreshes every 30 s).

Lost the token secret? Click **Install commands** on the token row — it mints a fresh secret
with the same label (old hashes stay valid until revoked; revoke stops future enrollments).

## Monitoring flow (all automatic)
- **Heartbeat** every 30 s → online/offline badge (>10 min silence = offline).
- **Inventory** every 5 min → click a probe row: drawer shows CPU/RAM/disks/services/patches.
- **Metrics** every 60 s → sparklines (CPU, RAM, disk-worst %, load, net up/down, temp).
- **LAN sweep** every 15 min over the CIDRs configured in Auto Discovery + tenant SNMP
  credentials → results land in the **Discovered Devices** tab AND in the normal
  Discovery pages; SNMP-matched devices fire your existing alert/notification rules.
No extra configuration is required beyond the CIDR ranges and SNMP credentials you
already manage under Asset Inventory → Auto Discovery.

## Security model
- Token secret is never stored (SHA-256 hash only); each token is bound to one org —
  a compromised probe cannot read another tenant.
- Probes only make OUTBOUND https calls; no inbound ports, no VPN needed.
- Web reads (`/api/agents/*`) are session-JWT and org-scoped; platform admins can pass `org_id`.

## Test lab recipe (before first real client)
1. Run the backend locally: `cd backend && alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000`
2. Log in as a client admin → create a token on the Agents page.
3. On any Ubuntu VM: `curl -fsSL http://<your-ip>:8000/downloads/goinfra/install.sh | sudo sh -s -- --server http://<your-ip>:8000 --token icag_…`
   (or run `goinfra enroll` manually from the built binary).
4. Check `goinfra check` on the probe, then watch the Fleet tab flip to Online within a minute;
   open the drawer for inventory/sparklines; add a second VM/container running `snmpd` in the
   same CIDR and confirm it appears in Discovered Devices + triggers an alert rule.

## Windows signing (production polish, not required for install)
- Cheapest: Azure Trusted Signing (~$10/mo) or an OV code-signing cert (~$200–400/yr via
  Sectigo/DigiCert resellers). Sign with:
  `signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 goinfra.exe`
- Unsigned builds trigger SmartScreen "More info → Run" once per machine; an EV cert removes that.
- **XP caveat:** Go ≥1.19 cannot target XP (needs Vista+). Cover XP estates via SNMP sweeps from
  a neighboring Win7+ probe instead of installing the agent there.
