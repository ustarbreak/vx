// Shared operations toolkit for the Security Services & Protection pages
// (Endpoint Protection, Email Security, Cloud Security, DNS Filtering,
//  Firewall Management, VPN Gateway, SD-WAN, Vulnerability Scanning,
//  Patch Management, Backup & DR).
//
// Every action button on those pages routes through runSecurityAction():
//  - Demo Mode ON  -> simulated execution against the in-memory demo world
//                     (no network), so analysts can rehearse playbooks safely.
//  - Real backend  -> POST /api/security-ops/actions; the FastAPI router
//                     validates the command catalog, queues the task toward
//                     the tenant's enrolled goinfra agents / configured
//                     device integrations and records it in the audit trail.
import { api } from './api';
import { isDemoMode } from './demoMode';

export interface SecurityActionDef {
  id: string;
  label: string;
  vendor?: string;          // firewall/SD-WAN editor: fortinet | cisco | paloalto | ...
  problem?: string;         // SD-WAN troubleshooting scenario key
  params?: string[];        // required parameter names (prompted in the modal)
}

export interface ActionField { name: string; label: string; placeholder?: string; options?: string[]; default?: string }

export interface ActionGroup {
  title: string;
  icon: string;             // lucide icon name resolved by the UI
  actions: SecurityActionDef[];
  fields?: ActionField[];   // extra inputs prompted before running the action
  danger?: boolean;
}

export interface RunResult {
  ok: boolean;
  actionId: string;
  message: string;
  output?: string;
  source: 'demo' | 'live';
}

const SECURITY_ACTION_PATH = '/security-ops/actions';

/** Execute an ops action. Never throws — callers always get a RunResult. */
export async function runSecurityAction(
  service: string,
  action: SecurityActionDef,
  params: Record<string, string> = {},
): Promise<RunResult> {
  const payload = { service, action_id: action.id, vendor: action.vendor ?? null, params };
  try {
    if (isDemoMode()) {
      // Simulated latency so the UI behaves exactly like the real dispatch.
      await new Promise((r) => setTimeout(r, 650));
      return {
        ok: true,
        actionId: action.id,
        source: 'demo',
        message: `Queued "${action.label}" on ${service} (simulated — Demo Mode). Task recorded in the platform audit trail.`,
        output: buildDemoOutput(service, action, params),
      };
    }
    const res = await api.post<any>(SECURITY_ACTION_PATH, payload);
    return {
      ok: res?.ok !== false,
      actionId: action.id,
      source: 'live',
      message: res?.message ?? `Dispatched "${action.label}" to the ${service} engine.`,
      output: typeof res?.output === 'string' ? res.output : JSON.stringify(res?.output ?? {}, null, 2),
    };
  } catch (e: any) {
    return { ok: false, actionId: action.id, source: 'live', message: e?.message ?? 'Action dispatch failed.' };
  }
}

/** Download helper used by log/syslog/SNMP/OID extraction buttons. */
export function downloadActionLog(filename: string, text: string): void {
  const blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------------------------------------------------------------------------
// Vendor-specific command catalogs (Firewall / SD-WAN editors). The analyst
// picks the exact vendor so the pushed commands match the real CLI/API.
// ---------------------------------------------------------------------------

export interface VendorCommand { cmd: string; note: string }

export const FIREWALL_VENDORS: Record<string, { label: string; push: VendorCommand[]; logs: VendorCommand[] }> = {
  fortinet: {
    label: 'Fortinet FortiGate',
    push: [
      { cmd: 'config system global; set admin-spraying enable; end', note: 'Anti-recon / port-scan protection' },
      { cmd: 'config firewall policy; edit <id>; set status disable; next; end', note: 'Disable a risky rule' },
      { cmd: 'execute restore certmgr ca <cert>', note: 'Push CA bundle update' },
      { cmd: 'config vpn ipsec phase1-interface; edit <tunnel>; set rekey-method new; end', note: 'Harden IPsec rekey' },
    ],
    logs: [
      { cmd: 'diagnose sys top 1 20', note: 'Live processes / sessions load' },
      { cmd: 'get system performance status', note: 'CPU / memory / session usage' },
      { cmd: 'diagnose sys session list | grep <ip>', note: 'All sessions touching a host' },
      { cmd: 'execute log filter category 3; execute log display', note: 'Extract forwarded traffic logs' },
    ],
  },
  cisco: {
    label: 'Cisco ASA / FTD',
    push: [
      { cmd: 'access-list OUTSIDE_IN extended deny ip <net> any log', note: 'Block + log an offending source' },
      { cmd: 'clear conn [all | <ip>] ; no asp drop', note: 'Drop stale/half-open connections' },
      { cmd: 'threat-detection scanning-threat shrouding', note: 'Enable scan detection & shrouding' },
      { cmd: 'vpn-sessiondb maxanyconn <n>', note: 'Limit concurrent VPN sessions per user' },
    ],
    logs: [
      { cmd: 'show conn detail', note: 'Current connection table' },
      { cmd: 'show logging | include %ASA-6-302015|%ASA-4-106023', note: 'Denied / interesting traffic' },
      { cmd: 'show local-host all', note: 'Per-host state incl. drops' },
      { cmd: 'show vpnsessiondb summary', note: 'Active VPN tunnels' },
    ],
  },
  paloalto: {
    label: 'Palo Alto Networks',
    push: [
      { cmd: 'set rule-hit-inspection threat default-action reset-both', note: 'Auto-protect stale threat rules' },
      { cmd: 'delete address <obj> ; commit partial nested', note: 'Remove abused address object' },
      { cmd: 'set profile-group <pg> web-blocking override disabled', note: 'Tighten blocking overrides' },
      { cmd: 'debug security-manager check panos-version', note: 'Verify content/AV version freshness' },
    ],
    logs: [
      { cmd: 'show counter global | match packet_drop', note: 'Drop counters overview' },
      { cmd: 'show log traffic regex "<ip>"', note: 'Traffic logs filtered by host' },
      { cmd: 'show high-availability state', note: 'HA cluster sync status' },
      { cmd: 'show session info', note: 'Session table utilisation' },
    ],
  },
  checkpoint: {
    label: 'Check Point Gaia',
    push: [
      { cmd: 'cvpnmgr add blacklist <ip> ttl 3600', note: 'Temporarily blacklist an attacker IP' },
      { cmd: 'fwmolq policy_install_all', note: 'Re-push installed policy to gateways' },
      { cmd: 'cpedit /objects_5_0/CVPNServer add ProposedBlackLists', note: 'Edit global blacklist object' },
    ],
    logs: [
      { cmd: 'fw monitor -e "accept;" -l', note: 'Live packet capture point list' },
      { cmd: 'cp_log dump -m "action:Drop" --last 1h', note: 'Dropped packets last hour' },
      { cmd: 'enabled_blades', note: 'Which security blades are active' },
    ],
  },
  opnsense: {
    label: 'OPNsense / pfSense',
    push: [
      { cmd: 'opnsense-clicommon configctl filter quicklog', note: 'Quick-log rule reload' },
      { cmd: 'pfctl -t malware -T add <ip>', note: 'Add IP to alias table (blocklists)' },
      { cmd: 'configctl filter reconfigure', note: 'Apply pending rule changes' },
    ],
    logs: [
      { cmd: 'clog /var/log/filter.log | tail -n 200', note: 'Latest firewall filter log lines' },
      { cmd: 'pfctl -s states | grep <ip>', note: 'State table entries for a host' },
      { cmd: 'configctl interface info <if>', note: 'Interface counters & status' },
    ],
  },
};

export const SDWAN_VENDORS: Record<string, { label: string; problems: Record<string, { label: string; commands: VendorCommand[] }> }> = {
  fortinet: {
    label: 'Fortinet FortiGate SD-WAN',
    problems: {
      packet_loss: { label: 'Packet loss / jitter on overlay', commands: [
        { cmd: 'diagnose sys sdwan health-check', note: 'SLA probe results per member' },
        { cmd: 'diagnose sys sdwan log', note: 'SD-WAN decision & quality logs' },
        { cmd: 'diagnose sys sdwan member-info', note: 'Per-member stats (RTT, loss, jitter)' },
      ]},
      tunnel_down: { label: 'Overlay tunnel down / IPsec flap', commands: [
        { cmd: 'diagnose vpn ike log-filter dst-addr4 <peer>', note: 'Filter IKE negotiation log' },
        { cmd: 'diagnose sys sdwan tunnel', note: 'Overlay tunnel table & state' },
        { cmd: 'execute ping <peer-wan-ip> interface <port>', note: 'Underlay reachability test' },
      ]},
      failover: { label: 'Wrong path chosen / no failover', commands: [
        { cmd: 'diagnose sys sdwan service', note: 'Which rule steers each application' },
        { cmd: 'get router info routing-table all', note: 'Verify SD-WAN route preference' },
        { cmd: 'diagnose sys sdwan neigh-cache', note: 'Remote peers reachable via which members' },
      ]},
      app_routing: { label: 'Application not steering correctly', commands: [
        { cmd: 'diagnose sys sdwan remote-stat-summary 0 all', note: 'Remote site per-app stats' },
        { cmd: 'diagnose application list', note: 'App-ID signature database loaded' },
      ]},
    },
  },
  cisco: {
    label: 'Cisco Viptela / vManage',
    problems: {
      packet_loss: { label: 'Loss/jitter on data policy tunnel', commands: [
        { cmd: 'show sdwan ipsec history', note: 'SA up/down history' },
        { cmd: 'show omp connections', note: 'OMP peer health' },
        { cmd: 'show bfd sessions detail', note: 'BFD timers & local-detect timeouts' },
        { cmd: 'show app-route tech-list all', note: 'per-packet load-balance quality' },
      ]},
      tunnel_down: { label: 'TLOC / control connection down', commands: [
        { cmd: 'show system status', note: 'vSmart/vBond reachability' },
        { cmd: 'show control connections', note: 'Control plane TLOC state' },
        { cmd: 'show tunnel destination', note: 'Data tunnel destinations' },
      ]},
      failover: { label: 'VPN route not failing over', commands: [
        { cmd: 'show vpn-route', note: 'Installed VPN routes & preferences' },
        { cmd: 'show app-route history', note: 'Color cost history driving steer' },
      ]},
      zbfw: { label: 'Zone-based firewall dropping traffic', commands: [
        { cmd: 'show zone-pair sessions', note: 'ZBFWS session/drop counters' },
        { cmd: 'show policy prefix-list', note: 'Data-policy match verification' },
      ]},
    },
  },
  paloalto: {
    label: 'Palo Alto Prisma SD-WAN (ION)',
    problems: {
      packet_loss: { label: 'Link degradation / SLA breach', commands: [
        { cmd: 'show circuit status', note: 'Circuit probes & SLA state' },
        { cmd: 'show statistics qoe', note: 'Quality-of-experience counters' },
      ]},
      tunnel_down: { label: 'ION-POP / tunnel down', commands: [
        { cmd: 'show control connections', note: 'Controller & POP sessions' },
        { cmd: 'show ipsec sa', note: 'IPsec SA establishment' },
      ]},
      failover: { label: 'Business intent not applied', commands: [
        { cmd: 'show policy cache', note: 'Advertised business-intent policies' },
        { cmd: 'show arp-table', note: 'LAN reachability sanity' },
      ]},
    },
  },
  velocloud: {
    label: 'VMware VeloCloud (Broadcom)',
    problems: {
      packet_loss: { label: 'Edge-to-edge loss', commands: [
        { cmd: 'debug dp show-path', note: 'Data-plane paths & loss stats' },
        { cmd: 'debug support report generate', note: 'Full support snapshot' },
      ]},
      tunnel_down: { label: 'Orchestrator / GW tunnel down', commands: [
        { cmd: 'debug orche show-state', note: 'Orchestrator sync state' },
        { cmd: 'debug dp show-tunnels', note: 'DTLS tunnel table' },
      ]},
    },
  },
  watchguard: {
    label: 'Watchguard (Firebox / CloudEdge)',
    problems: {
      packet_loss: { label: 'Branch link quality issues', commands: [
        { cmd: 'Status > Bandwidth Monitor / watchcli: show interface', note: 'Interface utilization & errors' },
        { cmd: 'watchcli -k <key> -cmd "show bo inc branch"', note: 'Branch Office (dim) membership & link state' },
        { cmd: 'Diagnostics > Packet Capture filtered on peer IP', note: 'Capture IKE/main-mode exchanges' },
      ]},
      tunnel_down: { label: 'Branch Office tunnel down', commands: [
        { cmd: 'watchcli -cmd "show bo inc"', note: 'Head-end dim status per branch' },
        { cmd: 'System > Log Viewer: filter "IKE" or "Main Mode"', note: 'Phase-1 negotiation failures' },
        { cmd: 'watchcli -cmd "reboot bo proxy"', note: 'Restart Branch Office proxy service' },
      ]},
      failover: { label: 'Failover / QoS misbehaviour', commands: [
        { cmd: 'watchcli -cmd "show interface group"', note: 'Failover group active member' },
        { cmd: 'show ap monitoring', note: 'AP gateway health for branches' },
      ]},
    },
  },
};

// ---------------------------------------------------------------------------
// Demo-mode realistic output builders (kept short — the modal renders them
// inside a monospace console panel).
// ---------------------------------------------------------------------------
function buildDemoOutput(service: string, action: SecurityActionDef, params: Record<string, string>): string {
  const target = params.device || params.host || params.ip || params.server || params.peer || params.site || 'all managed assets';
  const ts = new Date().toISOString();
  switch (service) {
    case 'endpoint-protection':
      return [
        `[${ts}] task=${action.id} target=${target}`,
        `policy_version=2026.10.31 rev applied to ${target}`,
        `agent acknowledged heartbeat within 12s — status: compliant`,
        `full-disk scan queued; realtime protection: ON; ransomware rollback: ARMED`,
      ].join('\n');
    case 'email-security':
      return [
        `[${ts}] task=${action.id} scope=${params.message_id || target}`,
        `tenant-wide search: 4 deliveries, 2 clicks tracked, 1 mailbox opened payload`,
        `purge executed on affected mailboxes; quarantine release requires approval`,
        `IOC synced to blocklists (sender, URL, attachment SHA-256)`,
      ].join('\n');
    case 'cloud-security':
      return [
        `[${ts}] task=${action.id} resource=${params.resource || target}`,
        `posture baseline re-evaluated: 143 controls, 11 failed, 2 blocked-public`,
        `auto-remediation template attached; drift detection scheduled hourly`,
      ].join('\n');
    case 'dns-filtering':
      return [
        `[${ts}] task=${action.id} resolver=${params.server || target}`,
        `dig @${params.server || '1.1.1.1'} ${params.domain || 'example.com'} -> NOERROR 5ms`,
        `DNSSEC validation: SECURE; open-resolver test: NOT OPEN; RCODE 0`,
        `blocklist sync ok: 412,908 domains; 3 newly matched this cycle`,
      ].join('\n');
    case 'firewall-mgmt':
      return [
        `[${ts}] task=${action.id} vendor=${params.vendor || action.vendor || 'generic'} device=${params.device || target}`,
        ...(FIREWALL_VENDORS[params.vendor || action.vendor || '']?.push.slice(0, 1)
          ? [`command rendered: "${FIREWALL_VENDORS[params.vendor || action.vendor].push[0].cmd}"`]
          : [`command batch staged (dry-run diff generated)`]),
        `config pushed to candidate datastore; apply requires change-window approval`,
        `syslog/SNMP poller: 2 traps received during window (see extracted log file)`,
      ].join('\n');
    case 'vpn-gateway':
      return [
        `[${ts}] task=${action.id} peer=${params.peer || target}`,
        `IKE SA: ESTABLISHED rekey in 3,214s | Child SAs: 2 active`,
        `throughput 148 Mbps, error rate 0.0%, MTU 1436 (fragmentation OK)`,
      ].join('\n');
    case 'sd-wan':
      return [
        `[${ts}] task=${action.id} vendor=${params.vendor || action.vendor} site=${params.site || target}`,
        `health-check: RTT 28ms loss 0.2% jitter 3ms — SLA MET on biz-intent "voice"`,
        `overlay tunnels: 4 up / 0 down; steering decisions logged to console`,
      ].join('\n');
    case 'vuln-scanning':
      return [
        `[${ts}] task=${action.id} scope=${params.target || target}`,
        `scanner task created (progressive mode, alive test only)`,
        `NVT feed 20261031 — CVE/NVD feed synced; MITRE ATT&CK mapping enabled`,
        `first hosts already reported: 2 critical candidates flagged for triage`,
      ].join('\n');
    case 'patch-management':
      return [
        `[${ts}] task=${action.id} collection=${params.collection || target}`,
        `software inventory collected: 214 distinct packages with versions`,
        `patch suggestions: 9 needed (3 security-critical), 2 reboot-required`,
        `deployment ring created; maintenance window Sun 02:00 UTC`,
      ].join('\n');
    case 'backup-dr':
      return [
        `[${ts}] task=${action.id} job=${params.job || target}`,
        `repository handshake OK (retention GFS: daily 7 / weekly 4 / monthly 12 / yearly 7)`,
        `verification run passed (checksum + mount test); restore point published`,
      ].join('\n');
    default:
      return `[${ts}] task=${action.id} dispatched`;
  }
}
