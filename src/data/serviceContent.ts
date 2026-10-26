// ─────────────────────────────────────────────────────────────────────────────
// Rich per-service marketing content for the public service pages.
//  - attackScenarios: ONLY on services that actually protect from attacks,
//    and every scenario is custom to its service (no shared fallback).
//  - howItWorks: collector-based pipeline (goinfra probe / SNMP / syslog / API)
//    describing how each service really runs inside the Infracentra platform.
//  - dataStory: animated technical mini-scenario — how your data is stored,
//    protected, backed up or isolated for that specific service.
//  - galleries: 3 image slides per service (Pexels/Unsplash stock imagery).
// ─────────────────────────────────────────────────────────────────────────────

export interface AttackScenario {
  title: string;
  subtitle: string;
  threatIcon: string;
  steps: { time: string; actor: 'attacker' | 'platform' | 'you'; text: string }[];
  code: string;
}

export interface HowStep {
  title: string;
  description: string;
  collector: 'goinfra agent' | 'SNMP' | 'syslog' | 'API' | 'netflow' | 'cloud API' | 'mail gateway';
  icon: string;
}

export interface GalleryImage { url: string; title: string; caption: string }

export interface DataFlowNode { id: string; label: string; sub: string; kind: 'source' | 'collector' | 'core' | 'storage' | 'sink' }
export interface DataFlowEdge { from: string; to: string; label: string }

export interface ServiceContent {
  protectsFromAttacks: boolean;
  attackScenario?: AttackScenario;
  howItWorks: HowStep[];
  dataStory: {
    headline: string;          // e.g. "How your telemetry is stored"
    animation: 'pipeline' | 'backup' | 'isolation' | 'encryption';
    flowNodes: DataFlowNode[];
    flowEdges: DataFlowEdge[];
    bullets: string[];
  };
  faqs: { q: string; a: string }[];
  gallery: GalleryImage[];
}

const px = (id: string) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1200&h=700&fit=crop`;

export const serviceContent: Record<string, ServiceContent> = {

  // ══════════════ SECURITY ══════════════
  'threat-intel': {
    protectsFromAttacks: true,
    attackScenario: {
      title: 'Zero-day C2 beacon intercepted before exfiltration',
      subtitle: 'A malware sample unknown to any AV engine phones home — the intel pipeline kills it in 4 seconds.',
      threatIcon: '🛰️',
      steps: [
        { time: 'T+0s', actor: 'attacker', text: 'New XDR loader variant beacons to 91.203.44.77:8443 — no signature exists anywhere.' },
        { time: 'T+1s', actor: 'platform', text: 'goinfra probe on the client VLAN mirrors the flow; NetFlow anomaly score jumps past baseline.' },
        { time: 'T+2s', actor: 'platform', text: 'Correlation engine matches destination IP against a MISP event ingested 6 minutes ago (confidence 0.97).' },
        { time: 'T+3s', actor: 'platform', text: 'Auto-blocklist push: firewall drops the IP, DNS sinkholes the domain, EDR kills PID 4412.' },
        { time: 'T+4s', actor: 'you', text: 'SOC receives one enriched alert — MITRE T1071.001, affected host, containment already applied.' },
      ],
      code: `# infracentra-cli — reproduce the block decision
$ ic ioc lookup --ip 91.203.44.77
source        misp/event-58231   (ingested 6m ago)
confidence    0.97  family="XDR-loader"  mitre=T1071.001
$ ic policy push --scope tenant-acme --action block-ip
firewall ✓  dns ✓  edr ✓   propagation 3.8s`,
    },
    howItWorks: [
      { title: 'Probe collects', description: 'The goinfra agent installed on the client network forwards process events, DNS queries and NetFlow samples over mTLS to the intel core.', collector: 'goinfra agent', icon: '📡' },
      { title: '40+ feeds ingested', description: 'MISP, OTX, CISA KEV and private partner feeds stream IoCs into the ingestion bus every minute.', collector: 'API', icon: '🧩' },
      { title: 'ML dedup & normalize', description: 'Indicators are de-duplicated (~85% noise cut), STIX-normalized and attributed to families and actors.', collector: 'API', icon: '🧠' },
      { title: 'Environment correlation', description: 'Every IoC is joined against the live asset inventory collected by the probes — you only see threats that can touch YOU.', collector: 'SNMP', icon: '🔗' },
      { title: 'Auto-enforcement', description: 'High-confidence indicators are pushed to firewalls, resolvers and EDR through the same policy engine used by Firewall Management.', collector: 'API', icon: '🚫' },
      { title: 'Analyst feedback loop', description: 'Triage decisions in the SOC view retrain confidence scoring per tenant, so your team tunes the feed, not the other way round.', collector: 'API', icon: '♻️' },
    ],
    dataStory: {
      headline: 'How threat data is stored & isolated',
      animation: 'isolation',
      flowNodes: [
        { id: 'feeds', label: '40+ Feeds', sub: 'MISP · OTX · KEV', kind: 'source' },
        { id: 'probe', label: 'goinfra probe', sub: 'client-side telemetry', kind: 'collector' },
        { id: 'bus', label: 'Ingestion bus', sub: 'tenant-tagged queue', kind: 'core' },
        { id: 'db', label: 'Encrypted store', sub: 'AES-256 · per-tenant key', kind: 'storage' },
        { id: 'soc', label: 'Your SOC view', sub: 'RBAC + audit log', kind: 'sink' },
      ],
      flowEdges: [
        { from: 'feeds', to: 'bus', label: 'stream' },
        { from: 'probe', to: 'bus', label: 'mTLS 443' },
        { from: 'bus', to: 'db', label: 'dedup+score' },
        { from: 'db', to: 'soc', label: 'query' },
      ],
      bullets: [
        'IoC intelligence is global; YOUR correlations and hits are encrypted with a per-tenant key and never leave your namespace.',
        'All lookups are logged in an immutable audit trail — who saw which indicator, when.',
        'Retention policy per plan: 90 days hot, 2 years archived, purge on demand.',
      ],
    },
    faqs: [
      { q: 'Do I need to send raw traffic out of my network?', a: 'No. The goinfra probe sends metadata (hashes, IPs, flow records) over outbound HTTPS only — never packet payloads.' },
      { q: 'Can I add our private threat feed?', a: 'Yes — MISP instances, TAXII endpoints or CSV drops can be onboarded from the admin UI in under 5 minutes.' },
      { q: 'What happens when an auto-block is wrong?', a: 'Every enforcement action is reversible with one click and has a TTL; false positives teach the per-tenant confidence model.' },
    ],
    gallery: [
      { url: px('612999'), title: 'Global threat map', caption: 'Live IoC streams from 40+ curated sources' },
      { url: px('546819'), title: 'MITRE ATT&CK correlation', caption: 'Every indicator mapped to techniques' },
      { url: px('8386766'), title: 'SOC enrichment view', caption: 'One alert, full context, auto-contained' },
    ],
  },

  'compliance': {
    protectsFromAttacks: false,
    howItWorks: [
      { title: 'Agents declare estate', description: 'Probes continuously report installed packages, services, OS versions and config state — the raw material for evidence.', collector: 'goinfra agent', icon: '📥' },
      { title: 'Device posture via SNMP', description: 'Firewalls, switches and backup appliances answer read-only SNMP queries; configs are fingerprinted against control requirements.', collector: 'SNMP', icon: '🔌' },
      { title: 'Controls auto-mapped', description: 'Collected facts are matched to NIST CSF 2.0, ISO 27001, SOC 2, PCI-DSS and DCSA controls — one fact can satisfy several frameworks.', collector: 'API', icon: '🗂️' },
      { title: 'Gap detection', description: 'Missing evidence becomes a prioritized gap with a remediation playbook and an estimated effort, not just a red cell.', collector: 'API', icon: '⚠️' },
      { title: 'Evidence snapshots', description: 'Each passing check stores a signed, timestamped evidence bundle (raw collector output + interpretation).', collector: 'syslog', icon: '🧾' },
      { title: 'Audit export', description: 'Auditors get a scoped read-only portal or a PDF/XLSX pack — nothing else about your environment is exposed.', collector: 'API', icon: '📤' },
    ],
    dataStory: {
      headline: 'How your compliance evidence is preserved',
      animation: 'encryption',
      flowNodes: [
        { id: 'agents', label: 'Collectors', sub: 'agent · SNMP · syslog', kind: 'collector' },
        { id: 'engine', label: 'Mapping engine', sub: '500+ controls', kind: 'core' },
        { id: 'vault', label: 'Evidence vault', sub: 'WORM · hash-chained', kind: 'storage' },
        { id: 'report', label: 'Audit pack', sub: 'signed export', kind: 'sink' },
      ],
      flowEdges: [
        { from: 'agents', to: 'engine', label: 'facts' },
        { from: 'engine', to: 'vault', label: 'sealed evidence' },
        { from: 'vault', to: 'report', label: 'on demand' },
      ],
      bullets: [
        'Evidence bundles are write-once (WORM) and hash-chained — tampering would invalidate the whole chain.',
        'Exports contain only what the selected framework asks for; scope reduction is the default.',
        'Rescans run every 24h by default; drift between scans raises an alert before an auditor finds it.',
      ],
    },
    faqs: [
      { q: 'Which frameworks ship pre-mapped?', a: 'NIST CSF 2.0, ISO 27001, SOC 2 Type II, PCI-DSS 4.0 and Morocco DCSA essentials; custom internal policies can be added as YAML.' },
      { q: 'Does the agent install anything on servers?', a: 'Only the single goinfra binary as a systemd unit / scheduled task. It is rootless-capable and uses <1% CPU steady-state.' },
      { q: 'Can our auditor log in directly?', a: 'Yes — generate a time-boxed, read-only auditor account from the Compliance page.' },
    ],
    gallery: [
      { url: px('708882'), title: 'Continuous control scoring', caption: 'Real-time posture across five frameworks' },
      { url: px('708883'), title: 'Evidence trails', caption: 'Signed, timestamped proof per control' },
      { url: px('4386466'), title: 'Audit day, stress-free', caption: 'One-click scoped auditor packs' },
    ],
  },

  'incident-response': {
    protectsFromAttacks: true,
    attackScenario: {
      title: 'Ransomware detonates on one laptop — stopped at the laptop',
      subtitle: 'Behavioral detection, isolation and rollback executed by the platform in 47 seconds.',
      threatIcon: '💀',
      steps: [
        { time: 'T+0s', actor: 'attacker', text: 'Trojanised invoice.exe runs; mass file-encryption pattern starts on FIN-LT-014.' },
        { time: 'T+3s', actor: 'platform', text: 'goinfra endpoint collector flags entropy spike + shadow-copy deletion in one process tree.' },
        { time: 'T+5s', actor: 'platform', text: 'IR playbook IR-RANSOM-01 fires: NIC quarantine via switch port VLAN move, SMB sessions killed.' },
        { time: 'T+11s', actor: 'platform', text: 'Forensic snapshot taken (memory, process tree, modified files list) BEFORE cleanup touches anything.' },
        { time: 'T+47s', actor: 'you', text: 'Incident card opens with timeline reconstructed, blast radius confirmed as 1 host, restore job queued from last clean backup.' },
      ],
      code: `# incident timeline — INC-2431 (auto-reconstructed)
T+0.0s   proc spawn   invoice.exe  (parent: outlook.exe)
T+2.8s   behavior     entropy>0.94 on 1,204 files  → ransomware heuristic
T+3.1s   behavior     vssadmin delete shadows      → destruction attempt
T+5.0s   response     vlan-quarantine FIN-LT-014   ✓ switch ACK
T+5.4s   response     kill-tree pid 4412           ✓ agent ACK
T+11s    forensics    snapshot sealed sha256:9f2c… ✓ WORM store
T+47s    status       contained · blast radius 1 host · MTTR 47s`,
    },
    howItWorks: [
      { title: 'Signals in', description: 'Agent events, firewall syslog and EDR alerts all land on the same incident bus with normalized severity.', collector: 'syslog', icon: '🚨' },
      { title: 'AI triage', description: 'Duplicates and correlated signals collapse into ONE incident with a blast-radius estimate built from the live CMDB.', collector: 'API', icon: '🧠' },
      { title: 'Playbooks fire', description: '25+ playbooks execute containment steps through the collectors: isolate host, disable AD account, block IOC, open ticket.', collector: 'goinfra agent', icon: '📖' },
      { title: 'Evidence locked', description: 'Snapshots and logs are sealed to WORM storage so the investigation trail survives even a compromised admin.', collector: 'API', icon: '🔒' },
      { title: 'War room', description: 'Technicians and client staff collaborate on the timeline; every action is attributed and reversible.', collector: 'API', icon: '💬' },
      { title: 'Post-mortem', description: 'Report auto-generated: root cause, dwell time, controls that failed, remediation tasks pushed to projects.', collector: 'API', icon: '📝' },
    ],
    dataStory: {
      headline: 'How incident data is protected end-to-end',
      animation: 'pipeline',
      flowNodes: [
        { id: 'src', label: 'Alert sources', sub: 'agent · syslog · EDR', kind: 'source' },
        { id: 'bus', label: 'Incident bus', sub: 'dedup + severity AI', kind: 'core' },
        { id: 'worm', label: 'WORM evidence', sub: 'immutable snapshots', kind: 'storage' },
        { id: 'resp', label: 'Response actions', sub: 'reversible, audited', kind: 'sink' },
      ],
      flowEdges: [
        { from: 'src', to: 'bus', label: 'events' },
        { from: 'bus', to: 'worm', label: 'seal' },
        { from: 'bus', to: 'resp', label: 'playbook' },
      ],
      bullets: [
        'Containment actions are dual-signed (platform + tenant token) — a breached platform account alone cannot isolate your servers.',
        'Evidence is written once, hash-chained, retained per your legal-hold policy.',
        'Full replay mode: auditors can re-run any incident timeline without touching production.',
      ],
    },
    faqs: [
      { q: 'How fast can containment actually be?', a: 'With a probe on-site, network-level isolation takes seconds (switch API/VLAN move). Host isolation averages 5–11s over outbound HTTPS.' },
      { q: 'Do you work outside business hours?', a: 'Yes — the 24/7 SOC monitors every tenant incident queue; critical playbooks run unattended by design.' },
      { q: 'Can we require human approval for destructive steps?', a: 'Every playbook step can be flagged approval-required; the platform waits for your ping/approval before proceeding.' },
    ],
    gallery: [
      { url: px('6795805'), title: 'Live incident war room', caption: 'Timeline, evidence and actions side by side' },
      { url: px('4165291'), title: 'Automated containment', caption: 'Isolation decisions in milliseconds' },
      { url: px('6466244'), title: 'Post-mortem reports', caption: 'Lessons learned generated automatically' },
    ],
  },

  'analytics': {
    protectsFromAttacks: false,
    howItWorks: [
      { title: 'All collectors feed one lake', description: 'Metrics from probes, SNMP device stats, syslog events and ticket history land in a tenant-partitioned time-series store.', collector: 'goinfra agent', icon: '🌊' },
      { title: 'Normalization', description: 'Different vendors, one schema: every datapoint carries asset, site, and service tags from the auto-discovered CMDB.', collector: 'SNMP', icon: '🧱' },
      { title: 'Risk engine', description: 'A 6-dimension model (exposure, patching, detection, response, resilience, access) computes a live 0–100 score.', collector: 'API', icon: '📈' },
      { title: 'Forecasting', description: '72-hour risk forecasts flag which assets will cross thresholds if nothing changes — act before, not after.', collector: 'API', icon: '🔮' },
      { title: 'KPI truth', description: 'MTTD/MTTR, SLA breaches and capacity trends computed from raw events, not cherry-picked exports.', collector: 'syslog', icon: '⏱️' },
      { title: 'Board-ready output', description: 'Executive dashboards and weekly PDF digests render straight from the same numbers your engineers see.', collector: 'API', icon: '📑' },
    ],
    dataStory: {
      headline: 'How your metrics are stored & aggregated',
      animation: 'pipeline',
      flowNodes: [
        { id: 'col', label: 'Collectors', sub: 'metrics every 60s', kind: 'collector' },
        { id: 'agg', label: 'Rollup engine', sub: 'raw→1m→1h→1d', kind: 'core' },
        { id: 'ts', label: 'TSDB', sub: 'compressed columnar', kind: 'storage' },
        { id: 'ui', label: 'Dashboards', sub: 'sub-second queries', kind: 'sink' },
      ],
      flowEdges: [
        { from: 'col', to: 'agg', label: 'samples' },
        { from: 'agg', to: 'ts', label: 'rollups' },
        { from: 'ts', to: 'ui', label: 'aggregates' },
      ],
      bullets: [
        'Raw resolution kept 30 days, hourly 1 year, daily 5 years — rollups make long ranges cheap to query.',
        'Columnar blocks are compressed ~11× and encrypted at rest per tenant.',
        'Analytics never sees cleartext secrets: credentials stay hashed at the edge collector.'
      ],
    },
    faqs: [
      { q: 'Where do the numbers come from?', a: 'Directly from your probes and devices — no manual entry, so dashboards cannot drift from reality.' },
      { q: 'Can we benchmark against peers?', a: 'Optional anonymized sector benchmarks (Moroccan industry groups); opt-in, off by default.' },
      { q: 'Data volume impact on our line?', a: '~40 KB/min per 100 assets. The agent batches and compresses; it is designed for low-bandwidth sites.' },
    ],
    gallery: [
      { url: px('708894'), title: 'Predictive risk radar', caption: 'Six dimensions, one honest score' },
      { url: px('5668860'), title: 'Executive reporting', caption: 'Board decks generated from live data' },
      { url: px('10042311'), title: 'Capacity forecasting', caption: 'See tomorrow’s bottlenecks today' },
    ],
  },

  'soar': {
    protectsFromAttacks: true,
    attackScenario: {
      title: 'Malicious login from a new country, handled while you sleep',
      subtitle: 'Impossible-travel alert → enrichment → adaptive auth → ticket, fully automated at 03:12.',
      threatIcon: '🔑',
      steps: [
        { time: '03:12', actor: 'attacker', text: 'Stolen cookie replays a session from a VPN exit 4,000 km from the user’s last login.' },
        { time: '03:12', actor: 'platform', text: 'IdP syslog triggers SOAR playbook SOAR-ATO-03 (impossible travel, confidence 0.91).' },
        { time: '03:12', actor: 'platform', text: 'Parallel enrichment: proxy IP reputation, device fingerprint match, HR roster check.' },
        { time: '03:13', actor: 'platform', text: 'Action set: revoke sessions, force FIDO2 re-auth, notify user via WhatsApp, hold ticket for morning review.' },
        { time: '08:05', actor: 'you', text: 'Analyst opens ONE closed incident with full evidence — zero pages woken, zero damage done.' },
      ],
      code: `# SOAR execution trace — run #88412
trigger      syslog.rule impossible_travel (0.3s)
enrich[∥]    iprep ✓  devicefp ✗(new)  hr-roster ✓  (1.1s total)
branch       new_device AND vpn_exit == TRUE → high_conf_ato
actions      idp.revoke_sessions      ✓ 0.4s
             idp.force_mfa_fido2      ✓ 0.2s
             notify.whatsapp(user)    ✓ 1.9s
             jira.create(LOW, review) ✓ 0.8s
result       contained · human_time_saved 41min · cost 0.0004 DH`,
    },
    howItWorks: [
      { title: 'Trigger anywhere', description: 'Playbooks start from agent events, SNMP traps, syslog rules, schedules or webhooks — the same bus everywhere.', collector: 'goinfra agent', icon: '⚡' },
      { title: 'Visual designer', description: 'Drag-and-drop steps with conditional branching, parallel lanes and approval gates; version-controlled like code.', collector: 'API', icon: '🎨' },
      { title: 'Native actions', description: 'Isolate hosts, move VLANs, block on firewalls, disable accounts, restore files — wired to the collectors, not copy-pasted scripts.', collector: 'SNMP', icon: '🛠️' },
      { title: 'Human gates', description: 'Destructive steps pause for ping/approval with a mobile-first review card; everything else runs at machine speed.', collector: 'API', icon: '✅' },
      { title: 'Dry-run & replay', description: 'Test playbooks against yesterday’s real incidents in sandbox before they ever touch production.', collector: 'API', icon: '🧪' },
      { title: 'Cost per automation', description: 'Each run reports time saved and compute cost so MSPs can price automations into client contracts.', collector: 'API', icon: '📊' },
    ],
    dataStory: {
      headline: 'How automation runs safely on your infrastructure',
      animation: 'isolation',
      flowNodes: [
        { id: 'trig', label: 'Triggers', sub: 'events · traps · cron', kind: 'source' },
        { id: 'sandbox', label: 'Playbook VM', sub: 'ephemeral per run', kind: 'core' },
        { id: 'gate', label: 'Approval gate', sub: 'human-in-the-loop', kind: 'core' },
        { id: 'exec', label: 'Collectors', sub: 'execute on-site', kind: 'sink' },
      ],
      flowEdges: [
        { from: 'trig', to: 'sandbox', label: 'spawn' },
        { from: 'sandbox', to: 'gate', label: 'risky step?' },
        { from: 'gate', to: 'exec', label: 'signed command' },
      ],
      bullets: [
        'Playbooks execute inside ephemeral sandboxes — no persistent credentials sit in the orchestrator.',
        'Commands reach devices through the already-authenticated probe channel; the platform never opens inbound ports on your side.',
        'Every action carries an idempotency key; replays after a crash cannot double-fire.'
      ],
    },
    faqs: [
      { q: 'How many integrations ship ready-made?', a: '200+ connectors; the ones that matter most (firewalls, AD/Entra, Slack/Teams/WhatsApp, ticketing) are pre-validated with Infracentra collectors.' },
      { q: 'What if a playbook does something wrong?', a: 'Actions are reversible where the target supports it, and every run has a full audit trace with a one-click rollback lane.' },
      { q: 'Can partners publish playbooks to their clients?', a: 'Yes — the marketplace supports private partner playbooks with parameter templates per client tenant.' },
    ],
    gallery: [
      { url: px('6424587'), title: 'Visual playbook builder', caption: 'Branching logic without writing glue code' },
      { url: px('8388041'), title: 'Machine-speed response', caption: 'Sub-second trigger to containment' },
      { url: px('6424589'), title: 'Approval gates', caption: 'Humans decide the risky steps' },
    ],
  },

  // ══════════════ NETWORKING ══════════════
  'network-monitoring': {
    protectsFromAttacks: true,
    attackScenario: {
      title: 'Lateral movement spotted on the switched LAN in 90 seconds',
      subtitle: 'An attacker walks from a printer VLAN to the finance core — topology-aware monitoring catches the stride.',
      threatIcon: '🕸️',
      steps: [
        { time: 'T+0s', actor: 'attacker', text: 'Compromised kiosk PC starts scanning 10.20.0.0/16 — normally unreachable from its access VLAN.' },
        { time: 'T+20s', actor: 'platform', text: 'Probe SNMP-polls switch MAC tables + NetFlow; a host appears on 14 ports in 30 s — impossible for a workstation.' },
        { time: 'T+45s', actor: 'platform', text: 'Topology engine correlates: source port flapping matches scanner fan-out signature; SMB/WinRM attempts to FIN-CORE-01 logged.' },
        { time: 'T+60s', actor: 'platform', text: 'Auto-action: access port shut, host moved to quarantine VLAN via switch API, ticket opened to NOC.' },
        { time: 'T+90s', actor: 'you', text: 'Network map shows the exact blast path with red edges — remediation is targeted, not guesswork.' },
      ],
      code: `# topology anomaly — sw-acc-14 (FortiSwitch)
poll  mac-table delta   window 30s
obs   src_mac 0a:1f:.. seen_on_ports=[Gi1/0/3..16] count=14
rule  fanout_scan        threshold 6 ports / 60s   → HIT
flow  10.20.7.33 → 10.20.0.0/16 SYN scan  dports=445,3389
act   err-disable Gi1/0/3 ✓   vlan-move QUARANTINE ✓   trap→snmptrapd ✓
state contained 90s · lateral_path recorded`,
    },
    howItWorks: [
      { title: 'Probe + SNMP discovery', description: 'On first boot the goinfra agent sweeps the local CIDR, walks CDP/LLDP/FDB via SNMP and builds the physical+logical map.', collector: 'SNMP', icon: '🗺️' },
      { title: '60s metric cycle', description: 'Interfaces, CPU, temp, uplinks and availability sampled per device; configurable down to 15s for critical gear.', collector: 'SNMP', icon: '⏲️' },
      { title: 'Flow visibility', description: 'NetFlow/sFlow/IPFIX from routers and core switches gives talk-pattern baselines per subnet.', collector: 'netflow', icon: '🌬️' },
      { title: 'Thresholds & baselines', description: 'Static thresholds plus self-learning baselines (seasonality-aware) so Monday-morning backup windows don’t page anyone.', collector: 'goinfra agent', icon: '📏' },
      { title: 'Dependency-aware alerts', description: 'When the firewall dies, its 40 downstream alerts collapse into one incident with the true root cause highlighted.', collector: 'API', icon: '🧩' },
      { title: 'Maps & RCA views', description: 'Live topology heat-maps, link utilization history and reachability traces exported for change reviews.', collector: 'API', icon: '🖥️' },
    ],
    dataStory: {
      headline: 'How device telemetry is stored',
      animation: 'backup',
      flowNodes: [
        { id: 'dev', label: 'Devices', sub: 'SNMP · flows', kind: 'source' },
        { id: 'probe', label: 'Site probe', sub: 'buffered locally', kind: 'collector' },
        { id: 'ts', label: 'Metric store', sub: '30d raw / 5y rollup', kind: 'storage' },
        { id: 'map', label: 'Topology graph', sub: 'versioned nightly', kind: 'sink' },
      ],
      flowEdges: [
        { from: 'dev', to: 'probe', label: 'poll' },
        { from: 'probe', to: 'ts', label: 'batch+gzip' },
        { from: 'ts', to: 'map', label: 'derive' },
      ],
      bullets: [
        'WAN outage? The probe spools up to 72h of samples locally and back-fills — no gaps in history.',
        'Topology snapshots are versioned nightly: diff “what changed since Friday” in one click.',
        'Community strings and probe credentials are AES-GCM sealed per tenant at rest.'
      ],
    },
    faqs: [
      { q: 'Which vendors are supported?', a: 'Cisco, Fortinet, Huawei, Juniper, HP/Aruba, Mikrotik, TP-Link/Sophos SMB gear — anything speaking SNMPv1/v2c/v3, plus NetFlow/sFlow exporters.' },
      { q: 'Does polling hurt device CPU?', a: 'SNMP walk cadence is rate-limited per device; typical impact is under 1% on enterprise gear, adaptive on small SOHO boxes.' },
      { q: 'Can we monitor multi-site from one pane?', a: 'Yes — each site gets a probe; the cloud view stitches all sites into one topology with per-site health.' },
    ],
    gallery: [
      { url: px('1181379'), title: 'Auto-discovered topology', caption: 'Every switch, link and VLAN mapped' },
      { url: px('708894'), title: 'Traffic baselines', caption: 'Seasonality-aware thresholds, fewer false pages' },
      { url: px('1149187'), title: 'Datacenter racks', caption: 'Environmental and hardware health combined' },
    ],
  },

  'dns-filtering': {
    protectsFromAttacks: true,
    attackScenario: {
      title: 'Phishing domain registered 20 minutes ago, blocked on first click',
      subtitle: 'Lookalike domain harvested from a brand-monitoring feed stops credential theft before the login page loads.',
      threatIcon: '🎣',
      steps: [
        { time: 'T+0s', actor: 'attacker', text: 'Criminal registers “acme-banque-secure.com” mimicking a client brand; QR sent by SMS.' },
        { time: 'T+18m', actor: 'platform', text: 'Brand-watch crawler + newly-registered-domain feed flag the lookalike; category engine confirms credential-harvest kit.' },
        { time: 'T+19m', actor: 'platform', text: 'Policy push: resolver sinks the domain for every managed client profile within one TTL.' },
        { time: 'T+22m', actor: 'attacker', text: 'Employee scans QR on office Wi-Fi → resolver answers block-page IP; nothing reaches the fake login.' },
        { time: 'T+23m', actor: 'you', text: 'Dashboard shows the blocked attempt, the campaign it belongs to, and which users got similar links.' },
      ],
      code: `# resolver decision log — acme-banque-secure.com
query        A  from 10.30.4.55 (profile: office-staff)
verdict      BLOCK  category=phishing_lookalike  age=18m
matched_by   brandwatch(acme) + nrd(<24h) + kit-signature(credential_form)
response     sinkhole 10.9.9.9 (block-portal)
telemetry    attempt logged · campaign linked · user notified (policy)`,
    },
    howItWorks: [
      { title: 'Resolver placement', description: 'Client DHCP hands out the Infracentra resolver (or forwarders upstream); per-device profiles come from the probe’s inventory.', collector: 'goinfra agent', icon: '🧭' },
      { title: 'Category intelligence', description: 'Billions of domains categorized — phishing, malware, C2, adult, gambling, streaming — refreshed continuously from the Threat Intel service.', collector: 'API', icon: '🏷️' },
      { title: 'Per-profile policies', description: 'Staff/guest/IoT/server profiles with different strictness, schedules and bypass windows, all enforced centrally.', collector: 'API', icon: '👥' },
      { title: 'Lookalike watch', description: 'Brand-monitoring crawls new registrations daily for typos of your trademarks — the classic BEC/phishing entry point.', collector: 'API', icon: '🕵️' },
      { title: 'Block portal', description: 'Friendly local-language block page with a one-click temporary override request that lands in your ticket queue.', collector: 'syslog', icon: '🚧' },
      { title: 'Full DNS audit', description: 'Every query verdict is logged (not cleartext content) for incident reconstruction and compliance evidence.', collector: 'syslog', icon: '📚' },
    ],
    dataStory: {
      headline: 'What your DNS logs look like (and what they don’t)',
      animation: 'encryption',
      flowNodes: [
        { id: 'stub', label: 'Client stub', sub: 'DHCP-assigned', kind: 'source' },
        { id: 'res', label: 'Filtered resolver', sub: 'EDNS-client-subnet off', kind: 'core' },
        { id: 'log', label: 'Verdict log', sub: 'name+decision only', kind: 'storage' },
        { id: 'dlp', label: 'Threat intel', sub: 'category sync', kind: 'sink' },
      ],
      flowEdges: [
        { from: 'stub', to: 'res', label: 'UDP/TCP 53 · DoH' },
        { from: 'res', to: 'log', label: 'async' },
        { from: 'dlp', to: 'res', label: 'categories' },
      ],
      bullets: [
        'We log the queried name and the verdict — never query contents, never correlate to browsing profiles beyond the device ID.',
        'Logs are truncated to 90 days by default (configurable per regulation).',
        'Resolver answers are signed (DNSSEC validated upstream) so spoofed A-records are caught at the edge.'
      ],
    },
    faqs: [
      { q: 'Do we have to change client hardware?', a: 'No. Filtering works by pointing DHCP/DNS at the resolvers, or by pushing the setting from the probe on managed segments.' },
      { q: 'What about DoH from browsers?', a: 'Policy enforcement optionally blocks known DoH endpoints at the firewall level; the probe detects bypass attempts and reports them.' },
      { q: 'Guest Wi-Fi included?', a: 'Yes — guest profile defaults to safe+adult-block with bandwidth-friendly categories; IoT profile blocks known device C2 domains.' },
    ],
    gallery: [
      { url: px('1108546'), title: 'Category control', caption: 'Policies per user group and schedule' },
      { url: px('8388041'), title: 'Threat feed sync', caption: 'Fresh categories from the intel core' },
      { url: px('4022200'), title: 'Family-safe offices', caption: 'Local block pages with override workflow' },
    ],
  },

  'firewall-mgmt': {
    protectsFromAttacks: true,
    attackScenario: {
      title: 'Forgotten test rule nearly costs the ERP — removed before abuse',
      subtitle: 'Shadow-rule exposure found by simulation, exploited attempt blocked the same week.',
      threatIcon: '🧱',
      steps: [
        { time: 'Day 1', actor: 'attacker', text: 'Internet scanner fingerprints the DMZ: old rule ANY→10.40.2.20:8443 (test Jasper) still wide open.' },
        { time: 'Day 1', actor: 'platform', text: 'Nightly policy analysis simulates reachability from WAN: ERP subnet flagged reachable through the stale NAT rule.' },
        { time: 'Day 2', actor: 'platform', text: 'Change request auto-created with suggested replacement (VPN-only + source pinning) and risk score 8.6/10.' },
        { time: 'Day 9', actor: 'attacker', text: 'Exploit attempts hit the rule window three times — each blocked because the rule was already narrowed.' },
        { time: 'Day 9', actor: 'you', text: 'Audit view proves closure: diff of policy before/after, approvals, and zero-hit confirmation on the old rule.' },
      ],
      code: `# policy simulation — fw-edge-01 (FortiGate 200E)
analyze  rules=412 nat=88 objects=1,204
finding  policy 217 "Jasper-test-2023" src=ALL dst=10.40.2.20:8443
         reachability_from(WAN) = TRUE   hits_last_90d = 0   risk = 8.6
suggest  replace → src=SSL-VPN-pool  action=deny-rest
deploy   diff-tested ✓ approved(mohammed) ✓ pushed 14:02
verify   hits(new)=3 blocked-attempt alerts forwarded ✓`,
    },
    howItWorks: [
      { title: 'Read-only onboarding', description: 'The probe pulls running-config and object groups via API/SNMP read-only creds — inventories every rule, NAT and address object.', collector: 'goinfra agent', icon: '📥' },
      { title: 'Unified policy model', description: 'FortiOS, PAN-OS, Check Point, Sophos, MikroTik and pfSense rules normalized into one intent-based model.', collector: 'API', icon: '🧮' },
      { title: 'Continuous analysis', description: 'Nightly simulations find shadowed, redundant, stale and overly-wide rules with a quantified risk score.', collector: 'API', icon: '🔎' },
      { title: 'Governed changes', description: 'Every push goes through approval, automatic diff-test and rollback snapshot — no more late-night copy-paste CLI.', collector: 'API', icon: '✍️' },
      { title: 'Threat-driven hardening', description: 'When Threat Intel flags an active campaign, candidate block rules are drafted here automatically for one-click approval.', collector: 'syslog', icon: '🛡️' },
      { title: 'Compliance export', description: 'Rulebase attestation reports (PCI 1.x, ISO 1.1) generated from live policy state, evidencing least-permit.', collector: 'API', icon: '🧾' },
    ],
    dataStory: {
      headline: 'How configurations are protected & restored',
      animation: 'backup',
      flowNodes: [
        { id: 'fw', label: 'Firewalls', sub: 'read-only pull', kind: 'source' },
        { id: 'core', label: 'Policy engine', sub: 'diff + simulate', kind: 'core' },
        { id: 'snap', label: 'Config vault', sub: 'versioned · encrypted', kind: 'storage' },
        { id: 'push', label: 'Controlled push', sub: 'signed commands', kind: 'sink' },
      ],
      flowEdges: [
        { from: 'fw', to: 'core', label: 'running-config' },
        { from: 'core', to: 'snap', label: 'pre-change snapshot' },
        { from: 'snap', to: 'push', label: 'rollback point' },
      ],
      bullets: [
        'Every managed change requires a fresh encrypted config snapshot taken BEFORE push — instant rollback guaranteed.',
        'Secrets inside configs (VPN PSKs, object passwords) are sealed with per-tenant keys and masked in the UI.',
        'Config history retained 18 months; “diff vs. last quarter” answers auditors in seconds.'
      ],
    },
    faqs: [
      { q: 'Which firewalls are supported day-one?', a: 'Fortinet, Palo Alto, Check Point, Sophos XG, Huawei USG, MikroTik and pfSense/OPNsense for SMB sites.' },
      { q: 'Will the platform lock me out?', a: 'Never — pushes are staged, verified with post-checks, and auto-revert if the management plane is lost after deploy.' },
      { q: 'Multi-vendor estates?', a: 'That is the point: one policy model, vendor-specific compilers, unified audit trail across brands.' },
    ],
    gallery: [
      { url: px('1149187'), title: 'Server-room security layer', caption: 'Edge and internal segmentation managed together' },
      { url: px('5668860'), title: 'Rulebase analytics', caption: 'Stale, shadowed and risky rules surfaced nightly' },
      { url: px('708882'), title: 'Governed deployments', caption: 'Approvals, diffs and instant rollback' },
    ],
  },

  'vpn-gateway': {
    protectsFromAttacks: true,
    attackScenario: {
      title: 'Stolen laptop tries to connect — device attestation says no',
      subtitle: 'Certificate-bound zero-trust access rejects a cloned credential in the first handshake.',
      threatIcon: '🕵️‍♂️',
      steps: [
        { time: 'T+0s', actor: 'attacker', text: 'Laptop stolen; thief extracts the user’s VPN cert + password from an unlocked session.' },
        { time: 'T+2m', actor: 'attacker', text: 'Connection attempted from a café IP: cert valid, but device posture fails (TPM key mismatch, disk crypto off).' },
        { time: 'T+2m', actor: 'platform', text: 'Gateway denies tunnel, keeps only the auth portal visible; anomaly event raised to SIEM with device fingerprint delta.' },
        { time: 'T+4m', actor: 'platform', text: 'SOAR-linked action: user session revoked everywhere, cert marked pending-revoke, laptop wiped via MDM command.' },
        { time: 'T+10m', actor: 'you', text: 'Security officer sees one clean narrative: attempt, rejection reason, containment — no breach, no noise.' },
      ],
      code: `# gateway decision — conn #77412
cert            VALID (chain ok, not expired)
device_attest   TPM-key binding  ✗ mismatch
                disk_encryption  ✗ reported OFF
                probe_presence   ✗ agent absent >24h
posture_score   31/100  → policy min 70
verdict         DENY tunnel · portal-only · event→siem
side_effects    sessions_revoked ✓ mdm-wipe-queued ✓ cert=pending-revoke ✓`,
    },
    howItWorks: [
      { title: 'Identity-first tunnels', description: 'WireGuard/OpenVPN tunnels bound to user + device certificate pairs; no shared secrets anywhere.', collector: 'goinfra agent', icon: '🔐' },
      { title: 'Posture gating', description: 'The probe reports disk encryption, patch level, running AV and TPM attestation before the gateway admits the device.', collector: 'goinfra agent', icon: '🩺' },
      { title: 'Micro-segmented grants', description: 'Access is per-application, not per-network: contractors see the ticketing app, finance sees the ERP — nothing else routable.', collector: 'API', icon: '🧬' },
      { title: 'Geo & risk policy', description: 'Country allow/deny, impossible-travel checks and IP reputation fed live from Threat Intelligence.', collector: 'API', icon: '🌍' },
      { title: 'Session observability', description: 'Per-session throughput, source geo, apps touched — searchable for investigations, exported for audits.', collector: 'syslog', icon: '📼' },
      { title: 'Break-glass access', description: 'Time-boxed emergency accounts with mandatory approval and full keystroke-level session recording.', collector: 'API', icon: '🚨' },
    ],
    dataStory: {
      headline: 'Privacy of your remote-access sessions',
      animation: 'encryption',
      flowNodes: [
        { id: 'cli', label: 'Remote user', sub: 'app-layer wireguard', kind: 'source' },
        { id: 'gw', label: 'Gateway cluster', sub: 'DoH-inspecting, non-logging', kind: 'core' },
        { id: 'meta', label: 'Metadata store', sub: 'sessions, no payloads', kind: 'storage' },
        { id: 'app', label: 'Internal apps', sub: 'micro-segment', kind: 'sink' },
      ],
      flowEdges: [
        { from: 'cli', to: 'gw', label: 'noise-proof wireguard' },
        { from: 'gw', to: 'app', label: 'per-app grant' },
        { from: 'gw', to: 'meta', label: 'session metadata' },
      ],
      bullets: [
        'Payloads pass through, never onto disk: only session metadata (who/when/what app/how much) is stored.',
        'Noise packets make port-scanning the gateway useless; pre-auth footprint is a single TLS listener.',
        'Key material lives in an HSM-backed KMS; rotation is automatic every 90 days.'
      ],
    },
    faqs: [
      { q: 'Do we still need our old VPN appliance?', a: 'You can keep it as a fallback; most clients decommission it after week two of the gateway handling posture-checked traffic.' },
      { q: 'Mobile workers?', a: 'iOS/Android clients support the same device attestation; the posture check simply uses mobile APIs instead of the desktop probe.' },
      { q: 'Latency impact?', a: 'WireGuard core adds <1 ms per hop; geo-anycast places you at the nearest of our Moroccan + EU gateways.' },
    ],
    gallery: [
      { url: px('708883'), title: 'Zero-trust access', caption: 'Every connection re-checked, every session recorded' },
      { url: px('1108546'), title: 'Per-app grants', caption: 'Contractors see apps, never networks' },
      { url: px('3945406'), title: 'Work from anywhere', caption: 'Posture-gated tunnels for mobile teams' },
    ],
  },

  'sd-wan': {
    protectsFromAttacks: false,
    howItWorks: [
      { title: 'Edge box inventory', description: 'Probes discover SD-WAN edges, underlay circuits and tunnels via SNMP/API; every link gets a quality profile.', collector: 'SNMP', icon: '📦' },
      { title: 'Per-app steering', description: 'Application classification (VoIP, ERP, SaaS) drives policy-based steering across MPLS/5G/fibre with SLA thresholds.', collector: 'API', icon: '🧭' },
      { title: 'Continuous probing', description: 'Twilio-style synthetic probes measure jitter/loss/latency per path every 10s; steering reacts before users feel it.', collector: 'goinfra agent', icon: '📡' },
      { title: 'Failover theatre', description: 'Scheduled chaos tests prove failovers work — you learn the RTO during a drill, not during an outage.', collector: 'API', icon: '🎭' },
      { title: 'Cost-aware routing', description: 'Metered links (4G/5G) burn budget; the controller offloads bulk traffic to unmetered paths when SLAs allow.', collector: 'API', icon: '💰' },
      { title: 'Branch light-weighting', description: 'Small branches run the probe on existing hardware — full SD-WAN policy without buying a rack appliance.', collector: 'goinfra agent', icon: '🪶' },
    ],
    dataStory: {
      headline: 'How path telemetry is kept & used',
      animation: 'backup',
      flowNodes: [
        { id: 'edge', label: 'SD-WAN edges', sub: 'probes every 10s', kind: 'source' },
        { id: 'ctrl', label: 'Controller', sub: 'steering decisions', kind: 'core' },
        { id: 'hist', label: 'Path history', sub: 'SLA evidence store', kind: 'storage' },
        { id: 'bill', label: 'Cost engine', sub: 'per-link meters', kind: 'sink' },
      ],
      flowEdges: [
        { from: 'edge', to: 'ctrl', label: 'quality vectors' },
        { from: 'ctrl', to: 'hist', label: 'decision log' },
        { from: 'hist', to: 'bill', label: 'usage' },
      ],
      bullets: [
        'Path-quality history doubles as SLA dispute evidence against carriers — timestamps and probes are exportable.',
        'Steering decisions are logged with the exact measurement window that justified them.',
        'Link meters aggregate bytes/cost per circuit; no packet contents are ever stored.'
      ],
    },
    faqs: [
      { q: 'Vendor-agnostic?', a: 'Yes — Cisco Viptela, Fortinet, Velocloud, Mikrotik-based and white-box edges are all steered through adapters.' },
      { q: 'Minimum bandwidth needed?', a: 'Control-plane telemetry is under 50 KB/s per site; probes run on the branch LAN itself.' },
      { q: 'Dual-carrier required?', a: 'Recommended, not required — the value proposition grows with each underlay you add.' },
    ],
    gallery: [
      { url: px('1181379'), title: 'Multi-site fabric', caption: 'Every branch, every circuit, one policy brain' },
      { url: px('430620'), title: 'Link quality wall', caption: 'Jitter/loss/latency per path, live' },
      { url: px('1149187'), title: 'Carrier-grade evidence', caption: 'SLA disputes settled with probe history' },
    ],
  },

  // ══════════════ PSA ══════════════
  'vuln-scanning': {
    protectsFromAttacks: true,
    attackScenario: {
      title: 'Log4Shell-class hole in a forgotten staging server',
      subtitle: 'Authenticated scan + CISA KEV correlation closes an exploitable gap attackers already route-scan for.',
      threatIcon: '🐛',
      steps: [
        { time: 'T+0s', actor: 'attacker', text: 'Botnets begin internet-wide sweeps for a freshly disclosed RCE in a middleware version.' },
        { time: 'T+30m', actor: 'platform', text: 'Nightly authenticated OpenVAS sweep finishes on the client LAN; staging-02 reports vulnerable middleware 2.14.' },
        { time: 'T+31m', actor: 'platform', text: 'KEV feed confirms active exploitation; asset is tagged internet-adjacent by the topology engine → CVSS bumped to priority 1.' },
        { time: 'T+2h', actor: 'platform', text: 'Virtual patch rule pushed to the WAF/firewall blocking the exploit URI pattern until the real fix ships.' },
        { time: 'Day 2', actor: 'you', text: 'Vendor patch deployed via Patch Management; rescan auto-verifies closure and files the evidence under the CVE record.' },
      ],
      code: `# scan result — staging-02 (authenticated)
plugin      openvas:114567  middleware 2.14.0-rce
kev         CISA KEV: YES (added 6h ago) · exploited_in_wild
topology    internet_adjacent=TRUE (nat rule 217)
priority    cvss 9.8 → tenant_priority P1
mitigation  waf virtual-patch rule vp-8842 pushed ✓
closure     rescan 2026-03-02T02:10 → GONE · evidence sealed ✓`,
    },
    howItWorks: [
      { title: 'Target auto-selection', description: 'The probe’s discovered device list defines scan scope per site — new gear is scanned before someone forgets it exists.', collector: 'goinfra agent', icon: '🎯' },
      { title: 'Authenticated depth', description: 'Credentialed scans (SSH/WMI/LDAP) read package inventories directly, cutting false positives versus banner guessing.', collector: 'goinfra agent', icon: '🔑' },
      { title: 'Web + network layers', description: 'OpenVAS for infrastructure, OWASP ZAP for web apps; both results merged into one finding ledger per asset.', collector: 'API', icon: '🕸️' },
      { title: 'Exploit-context ranking', description: 'CVEs ranked by EPSS + CISA KEV + your topology: what matters is what is reachable AND being exploited.', collector: 'API', icon: '📊' },
      { title: 'Remediation handoff', description: 'Findings become tickets with the exact fix path; patchable ones queue directly into Patch Management windows.', collector: 'API', icon: '🔁' },
      { title: 'Proof of closure', description: 'Auto-rescan after remediation seals before/after evidence — auditors accept closure receipts, not promises.', collector: 'API', icon: '✅' },
    ],
    dataStory: {
      headline: 'How scan results stay confidential',
      animation: 'isolation',
      flowNodes: [
        { id: 'scan', label: 'Scan engine', sub: 'runs per-tenant', kind: 'collector' },
        { id: 'iso', label: 'Tenant shard', sub: 'row-level isolation', kind: 'core' },
        { id: 'enc', label: 'Findings DB', sub: 'field-level encryption', kind: 'storage' },
        { id: 'rbac', label: 'Need-to-know UI', sub: 'techs see hosts they own', kind: 'sink' },
      ],
      flowEdges: [
        { from: 'scan', to: 'iso', label: 'results' },
        { from: 'iso', to: 'enc', label: 'sealed' },
        { from: 'enc', to: 'rbac', label: 'scoped reads' },
      ],
      bullets: [
        'Vulnerability lists are the blueprint attackers want — field-level encryption plus RBAC means even our ops staff cannot bulk-export them.',
        'Scan credentials are vault-held, used per-job and rotated on your schedule.',
        'Report watermarks track every PDF export back to the requesting account.'
      ],
    },
    faqs: [
      { q: 'Authenticated or unauthenticated?', a: 'Both available; authenticated is strongly recommended and trivial once the probe is installed since package inventory is already collected.' },
      { q: 'Scan window safety?', a: 'Rate limits, maintenance-window scheduling and non-invasive plugin sets keep production gear alive; aggressive plugins are opt-in per host.' },
      { q: 'OT/IoT devices?', a: 'Passive fingerprinting (from probe + flow data) covers printers, cameras and PLCs that must never be actively scanned.' },
    ],
    gallery: [
      { url: px('546819'), title: 'Finding ledger', caption: 'One place for every CVE across tools' },
      { url: px('8386766'), title: 'Exploit-aware ranking', caption: 'KEV + EPSS + reachability weighting' },
      { url: px('271013'), title: 'Closure evidence', caption: 'Before/after rescans filed automatically' },
    ],
  },

  'patch-management': {
    protectsFromAttacks: true,
    attackScenario: {
      title: 'Patch Tuesday weaponized in 36 hours — estate patched in 9',
      subtitle: 'The race is between vendors’ exploits and your deployment pipeline. This one you won.',
      threatIcon: '🩹',
      steps: [
        { time: 'Tue 09:00', actor: 'platform', text: 'Microsoft publishes 3 critical CVEs; probe inventory shows 214 affected endpoints across 3 sites.' },
        { time: 'Tue 10:30', actor: 'platform', text: 'Compatibility check passes (app inventory + driver matrix); staged ring approved automatically, prod rings queued.' },
        { time: 'Wed 18:00', actor: 'attacker', text: 'Public exploit code appears; scans start hunting unpatched hosts.' },
        { time: 'Wed 18:05', actor: 'platform', text: 'Attempted exploitation from two IPs hits already-patched hosts — CVE not applicable; intel feed auto-blacklists the scanners.' },
        { time: 'Thu 06:00', actor: 'you', text: 'Compliance report: 214/214 patched, reboot windows honored, exception list empty. Evidence sealed.' },
      ],
      code: `# patch campaign PC-2431 rollout
affected   214 endpoints (probe inventory, CVE-2026-31337)
rings      canary(6) ✓ 12m → pilot(48) ✓ 3h → broad(160) ✓ overnight
safeties   golden-image snapshot ✓ rollback=wsus-restore ✓
exceptions none (finance-server ring deferred to weekend window)
verification  post-reboot scan → 0 findings · evidence sealed ✓`,
    },
    howItWorks: [
      { title: 'Inventory truth', description: 'The probe enumerates OS builds, packages and third-party apps nightly — you patch what actually exists, not what the spreadsheet says.', collector: 'goinfra agent', icon: '📦' },
      { title: 'Advisory matching', description: 'Vendor advisories (MSRC, Debian ESA, Red Hat RXSA) matched to installed versions with exploit-context scoring.', collector: 'API', icon: '🔔' },
      { title: 'Ring orchestration', description: 'Canary → pilot → broad deployment rings with maintenance windows, deferrals and dependency-aware ordering.', collector: 'goinfra agent', icon: '🎚️' },
      { title: 'Safety nets', description: 'Golden-image snapshots and scripted rollback before every prod-ring push; failed installs auto-quarantine the host.', collector: 'API', icon: '🪂' },
      { title: 'Third-party coverage', description: 'Browsers, runtimes, Java, 7-Zip… the boring-but-breached stuff patched on the same cadence as the OS.', collector: 'goinfra agent', icon: '🧩' },
      { title: 'Compliance receipt', description: 'Patch-status evidence auto-filed under CIS/ISO controls; exceptions carry expiry dates and approver names.', collector: 'API', icon: '🧾' },
    ],
    dataStory: {
      headline: 'How patch safety is engineered',
      animation: 'backup',
      flowNodes: [
        { id: 'inv', label: 'Package inventory', sub: 'nightly from probes', kind: 'collector' },
        { id: 'plan', label: 'Campaign planner', sub: 'rings + windows', kind: 'core' },
        { id: 'snap', label: 'Snapshot vault', sub: 'golden images', kind: 'storage' },
        { id: 'host', label: 'Endpoints', sub: 'apply + verify', kind: 'sink' },
      ],
      flowEdges: [
        { from: 'inv', to: 'plan', label: 'affected set' },
        { from: 'plan', to: 'snap', label: 'pre-push snapshot' },
        { from: 'snap', to: 'host', label: 'rollback point' },
      ],
      bullets: [
        'No prod-ring push proceeds without a verified snapshot — rollback is a promise, not a hope.',
        'Patch binaries are fetched from official vendor mirrors and hash-pinned per campaign.',
        'Reboot behavior respects user presence (workstation) vs. windows (servers) driven by probe liveness data.'
      ],
    },
    faqs: [
      { q: 'Linux and Windows together?', a: 'Yes — native handling for apt/dnf/zypper plus WSUS/Intune-compatible rings for Windows, including legacy Win7-era hosts via extended agents.' },
      { q: 'What about servers we cannot reboot?', a: 'Deferral policies with forced expiry: the exception ages visibly on dashboards and compliance scores until resolved.' },
      { q: 'Bandwidth for 200 endpoints?', a: 'Local caching: the site probe acts as a distribution point, so patches download once per site, not per machine.' },
    ],
    gallery: [
      { url: px('271013'), title: 'Rollout rings', caption: 'Canary to broad with automatic brakes' },
      { url: px('1181243'), title: 'Patch dashboard', caption: 'Coverage per site, per OS, per CVE' },
      { url: px('708882'), title: 'Verified closure', caption: 'Post-patch rescans seal the evidence' },
    ],
  },

  'backup-dr': {
    protectsFromAttacks: true,
    attackScenario: {
      title: 'Ransomware encrypts production AND tries the backups',
      subtitle: 'Immutable copies held the line; full recovery in 41 minutes with zero ransom paid.',
      threatIcon: '🔥',
      steps: [
        { time: '01:40', actor: 'attacker', text: 'Domain admin compromised; attacker disables VSS, deletes local backup targets, deploys encryptor.' },
        { time: '01:44', actor: 'platform', text: 'Probe reports mass-delete on backup shares + anomalous admin session → IR playbook isolates the DC, freezes backup jobs.' },
        { time: '01:45', actor: 'attacker', text: 'Attacker reaches the backup console with stolen creds — and finds Object Lock: last 30 days are physically undeletable.' },
        { time: '02:10', actor: 'platform', text: 'Clean restore points identified (last good before 01:40); staged restore spins up in an isolated recovery VPC, malware-scanned.' },
        { time: '02:21', actor: 'you', text: 'Go/no-go from the war room; production cut-over completes 02:21→02:41. RPO met at 26 min, RTO 41 min, evidence pack auto-assembled.' },
      ],
      code: `# immutability + restore ledger
job        nightly-full-vm-cluster  retention 30d OBJECT-LOCK(compliance)
attempt    delete-before-date(0) → DENIED (S3 ObjectLockCompliant)
attempt    purge via console     → DENIED (no IAM principal holds delete)
select     rp-2026-03-01T01:12Z  last-known-good (integrity hash ✓)
staged     recovery-VPC clone → av-scan ✓ smoke-tests ✓
cutover    02:21Z → 02:41Z   RPO=26m RTO=41m  SLA ✓
ledger     every restore step hash-chained for insurer/auditor`,
    },
    howItWorks: [
      { title: 'What-if inventory', description: 'Probes enumerate workloads, DB engines and dependencies so backup plans cover the real estate, including the forgotten NAS.', collector: 'goinfra agent', icon: '🗃️' },
      { title: 'Job orchestration', description: 'Veeam, Proxmox Backup Server, Borg/restic and native cloud snapshots driven from one policy layer with app-consistent quiescing.', collector: 'API', icon: '🧰' },
      { title: '3-2-1-1-0 enforced', description: 'Three copies, two media, one offsite, one immutable/object-locked, zero errors — verified by continuous test-restores, not wishful thinking.', collector: 'API', icon: '🔢' },
      { title: 'Air-gap & vault', description: 'Copy-on-write vault with delayed deletion windows; deleting anything requires two humans and a timer.', collector: 'API', icon: '🏦' },
      { title: 'Recovery drills', description: 'Monthly automated restores into an isolated sandbox with application smoke tests — DR evidence without dragging your team into a fire drill.', collector: 'API', icon: '🎯' },
      { title: 'RPO/RTO dashboards', description: 'Live compliance with contractual recovery objectives per system, alarming before a missed window becomes a breach.', collector: 'syslog', icon: '⏳' },
    ],
    dataStory: {
      headline: 'Exactly how your backups are made untouchable',
      animation: 'backup',
      flowNodes: [
        { id: 'src', label: 'Workloads', sub: 'VMs · DBs · files', kind: 'source' },
        { id: 'eng', label: 'Backup engine', sub: 'dedupe + encrypt', kind: 'core' },
        { id: 'obj', label: 'Object-lock store', sub: 'WORM 30d+', kind: 'storage' },
        { id: 'gap', label: 'Air-gapped copy', sub: 'delayed delete', kind: 'sink' },
      ],
      flowEdges: [
        { from: 'src', to: 'eng', label: 'changed blocks' },
        { from: 'eng', to: 'obj', label: 'sealed blobs' },
        { from: 'obj', to: 'gap', label: 'replicate+lock' },
      ],
      bullets: [
        'Client-side AES-256 encryption before transport: the storage provider (any provider) stores only opaque sealed blobs.',
        'Object Lock in compliance mode makes the retention period mathematically undeletable — even by the account owner.',
        'Restore points are hash-manifested; a silent-corruption scan verifies readability nightly, not on disaster day.'
      ],
    },
    faqs: [
      { q: 'Which platforms are covered?', a: 'VMware, Hyper-V, Proxmox, Windows/Linux filesystems, MSSQL/PostgreSQL/MySQL app-consistent agents, plus AWS/Azure/GCP snapshot orchestration.' },
      { q: 'Can admins delete backups if they turn evil?', a: 'Deletion inside the retention window is impossible (object lock) and outside it requires dual-control approval with a 72h delay.' },
      { q: 'How often do you actually test restores?', a: 'Continuously — a rotating subset of every protection group is test-restored daily; full DR rehearsal monthly with a report.' },
    ],
    gallery: [
      { url: px('1149187'), title: 'Vault infrastructure', caption: 'Immutable storage with delayed-deletion air gap' },
      { url: px('430620'), title: 'Recovery dashboard', caption: 'Live RPO/RTO compliance per workload' },
      { url: px('271013'), title: 'Drill day, every month', caption: 'Automated sandbox restores with smoke tests' },
    ],
  },

  'endpoint-protection': {
    protectsFromAttacks: true,
    attackScenario: {
      title: 'Fileless PowerShell heist from the finance share',
      subtitle: 'No binary on disk, no signature to catch — behavioral telemetry ends it in 6 seconds.',
      threatIcon: '👻',
      steps: [
        { time: 'T+0s', actor: 'attacker', text: 'Macro runs regsvr32 with a remote scriptlet; payload lives only in memory (LOLBins, no files).' },
        { time: 'T+2s', actor: 'platform', text: 'goinfra EDR sensor observes AMSI calls decrypting a known-malicious pattern + abnormal child-process tree.' },
        { time: 'T+3s', actor: 'platform', text: 'Process suspended instantly; memory sample captured for the intel pipeline (feeds Threat Intelligence next).', },
        { time: 'T+5s', actor: 'platform', text: 'Lateral check: SMB session enumeration by the same token blocked at the share ACL via auto-hardening.' },
        { time: 'T+6s', actor: 'you', text: 'Alert arrives with process tree, scriptlet decoded, and the patient-zero email linked — containment already done.' },
      ],
      code: `# edr verdict — host FIN-PC-031
tree     excel.exe → regsvr32.exe → powershell(-enc) → rundll32
signals  amsi.decoded_pattern=match(T1059.001)  parent-child=anomalous
         scriplet_url → intel: known hosting (conf .93)
action   suspend-tree ✓  capture-mem ✓  kill-token-sessions ✓
lateral  smb-enumerate by token → ACL-blocked ✓
time     detection→containment 6.0s · dwell prevented`,
    },
    howItWorks: [
      { title: 'Single lightweight sensor', description: 'Same goinfra binary as monitoring: adds process/file/network behavioral telemetry with kernel filters (eBPF on Linux, ETW on Windows).', collector: 'goinfra agent', icon: '🩹' },
      { title: 'Behavioral AI', description: 'Attack-chain classifiers (MITRE-mapped) catch fileless and living-off-the-land techniques signatures miss.', collector: 'API', icon: '🧠' },
      { title: 'Instant containment', description: 'Host isolation, process-tree kill, token revocation — executed by the sensor even when the WAN is down.', collector: 'goinfra agent', icon: '🚔' },
      { title: 'Rollback guard', description: 'Encryption-behavior tripwire pauses writes and restores from local shadow cache while confirming verdict.', collector: 'goinfra agent', icon: '↩️' },
      { title: 'USB & device control', description: 'Whitelisted removable media, auto-scan on insert, encrypted-volume enforcement per device class.', collector: 'goinfra agent', icon: '🔌' },
      { title: 'One console', description: 'Windows, macOS, Linux (incl. XP-era legacy tier via reduced collector) managed alongside servers.', collector: 'API', icon: '🖥️' },
    ],
    dataStory: {
      headline: 'What the EDR sensor does NOT collect',
      animation: 'isolation',
      flowNodes: [
        { id: 'os', label: 'Kernel events', sub: 'process/net/file', kind: 'source' },
        { id: 'filt', label: 'Edge filter', sub: 'drops personal data', kind: 'collector' },
        { id: 'cloud', label: 'Detection core', sub: 'behavioral models', kind: 'core' },
        { id: 'box', label: 'Evidence locker', sub: 'mem-samples, tenant key', kind: 'storage' },
      ],
      flowEdges: [
        { from: 'os', to: 'filt', label: 'raw events' },
        { from: 'filt', to: 'cloud', label: 'security-relevant only' },
        { from: 'cloud', to: 'box', label: 'sealed samples' },
      ],
      bullets: [
        'Keystrokes, screen content, documents and browser history are structurally out of scope — the event filter drops them at the edge.',
        'Memory samples are encrypted with your tenant key before leaving the host.',
        'GDPR/LCDP alignment: processing register + DPIA template shipped with the service.'
      ],
    },
    faqs: [
      { q: 'Does it replace our current AV?', a: 'It can, or it coexists — most clients run it beside a signature AV for defense-in-depth; conflicts are tuned out of the box.' },
      { q: 'Performance on old machines?', a: 'The sensor idles near 0.5% CPU; on spinning-disk/XP-era tiers it falls back to a reduced passive collector.' },
      { q: 'Offline protection?', a: 'Yes — cached verdicts and local containment work with no connectivity; reconciliation happens on reconnect.' },
    ],
    gallery: [
      { url: px('612999'), title: 'Behavioral engine', caption: 'Chains, not signatures' },
      { url: px('546819'), title: 'Live process trees', caption: 'Attack paths rendered as they happen' },
      { url: px('8386766'), title: 'One fleet console', caption: 'Servers, laptops, kiosks, legacy' },
    ],
  },

  'email-security': {
    protectsFromAttacks: true,
    attackScenario: {
      title: 'CEO fraud wire request, caught between “Sent” and “Inbox”',
      subtitle: 'Lookalike display-name spoof + payment keyword + odd timing = quarantine in 400 ms.',
      threatIcon: '✉️',
      steps: [
        { time: 'T+0s', actor: 'attacker', text: 'attacker registers “acme-group-co.com”, sends “URGENT wire today – CEO” with a pixel-perfect logo.' },
        { time: 'T+0.2s', actor: 'platform', text: 'MX gateway: SPF fail, DKIM absent, display-name matches exec list, domain age 3 days, payment language + urgency score 0.94.' },
        { time: 'T+0.4s', actor: 'platform', text: 'Quarantined before delivery; URL detonated in sandbox (credential form on fake ERP) confirms phishing.' },
        { time: 'T+1m', actor: 'platform', text: 'Similar messages to 6 other staff quarantined retroactively; tenant-wide block on the sender domain.' },
        { time: 'T+5m', actor: 'you', text: 'Finance manager gets a training micro-alert: “here’s what would have fooled you” — the best phishing lesson is the one that arrived.' },
      ],
      code: `# message verdict msg-88412
headers   spf=fail dkim=none dmarc=quarantine
identity  display_name≈["CEO","CFO"] (levenshtein≤2)  domain_age=3d
content   intent=BEC_wire  urgency=high  lang_mix=FR/EN anomaly
url       sandbox → fake-erp-login (kit: EvilERP) conf .96
verdict   QUARANTINE @ 400ms · retro-sweep 6 msgs · domain block ✓
user      micro-training card delivered ✓`,
    },
    howItWorks: [
      { title: 'Seamless MX takeover', description: 'Point your MX at the gateway (or drop the probe inline for outbound inspection); mail flow continues even during maintenance.', collector: 'syslog', icon: '📮' },
      { title: 'Authentication stack', description: 'SPF/DKIM/DMARC verdicts plus BIMI display, with guided record fixes for domains that fail today.', collector: 'API', icon: '🧾' },
      { title: 'Impersonation AI', description: 'Per-tenant directory graph learns who executives/vendors are and flags lookalikes, display-name spoofs and unusual reply-to chains.', collector: 'API', icon: '🎭' },
      { title: 'URL detonation', description: 'Every link rewritten and detonated in headless browsers at click time — late-stage phishing URLs die at the redirect.', collector: 'goinfra agent', icon: '💣' },
      { title: 'Attachment sandbox', description: 'Office/PDF/zip analyzed statically + dynamically; malicious macros extracted as IoCs into Threat Intelligence.', collector: 'API', icon: '🔬' },
      { title: 'Human firewall', description: 'One-click “report phishing” trains per-user susceptibility; repeat clickers get micro-training, not punishment.', collector: 'syslog', icon: '🧠' },
    ],
    dataStory: {
      headline: 'Mail privacy: what is inspected, what is never stored',
      animation: 'encryption',
      flowNodes: [
        { id: 'mta', label: 'MTA relay', sub: 'TLS enforced', kind: 'source' },
        { id: 'ana', label: 'Analysis farm', sub: 'ephemeral sandboxes', kind: 'core' },
        { id: 'met', label: 'Metadata only', sub: 'hashes, verdicts', kind: 'storage' },
        { id: 'mbx', label: 'Mailbox', sub: 'clean delivery', kind: 'sink' },
      ],
      flowEdges: [
        { from: 'mta', to: 'ana', label: 'suspicious only' },
        { from: 'ana', to: 'met', label: 'verdict+hash' },
        { from: 'mta', to: 'mbx', label: 'pass-through' },
      ],
      bullets: [
        'Clean mail streams through untouched — bodies of passing messages are never persisted.',
        'Quarantined items are encrypted at rest and purged automatically after 30 days.',
        'Message hashes let you prove a specific email’s verdict without storing its content.'
      ],
    },
    faqs: [
      { q: 'Do we lose Microsoft 365 mail flow?', a: 'No — the gateway slots in as smart-host; Exchange Online continues working exactly as before, cleaner.' },
      { q: 'Outbound protection too?', a: 'Yes — compromised-account spam and data-loss patterns are inspected on the way out, protecting your domain reputation.' },
      { q: 'Support French/Arabic phishing content?', a: 'Language models trained on Maghrebi-French BEC phrasing — a common blind spot of US-centric gateways.' },
    ],
    gallery: [
      { url: px('4022200'), title: 'Inbox shield', caption: 'BEC and phishing verdicts in milliseconds' },
      { url: px('708883'), title: 'Directory awareness', caption: 'Who really writes to your CFO' },
      { url: px('5668860'), title: 'Click-time safety', caption: 'Links detonated when opened, not when received' },
    ],
  },

  'cloud-security': {
    protectsFromAttacks: true,
    attackScenario: {
      title: 'Public S3 bucket with payroll data, found before the leak sites did',
      subtitle: 'Misconfiguration detected at creation, exploited attempt blocked 3 hours later.',
      threatIcon: '☁️',
      steps: [
        { time: 'T+0s', actor: 'attacker', text: 'Cloud-scanning bots index new public buckets daily looking for credential dumps and PII.' },
        { time: 'T+0s', actor: 'platform', text: 'CSPM config poller notices dev-payments-us bucket created with public ACL + unencrypted SSE.' },
        { time: 'T+2m', actor: 'platform', text: 'Auto-remediation (tenant-approved policy): public access blocked, bucket policy tightened, SSE-KMS enabled, versioning on.' },
        { time: 'T+3h', actor: 'attacker', text: 'Scanner returns with the leaked bucket URL from a listing site — every GET now 403s, alarms fire on the retry pattern.' },
        { time: 'T+3h', actor: 'you', text: 'Ticket shows the full arc: creation event, remediation, blocked exploitation, and the IAM user who created it — coaching, not blame.' },
      ],
      code: `# cspm event chain
detect   aws.s3.CreateBucket dev-payments-us  public_acl=TRUE enc=NONE
policy   auto_remediate(tenant-approved) → block_public ✓ sse-kms ✓ versioning ✓
intel    bucket-url appeared on leak-list bot (3h later)
attempts GET ×41 → 403 AccessDenied · alarm cloud-exfil-pattern fired
trace    creator=iap-dev-junior → iam review suggestion attached`,
    },
    howItWorks: [
      { title: 'Read-only trust', description: 'Cross-account roles / service principals with read-only scopes; keys never leave your cloud, evidence stays in yours.', collector: 'cloud API', icon: '🤝' },
      { title: 'Hybrid ground truth', description: 'Probes reconcile on-prem CMDB with cloud resources — the migration stragglers and shadow IT become visible in both directions.', collector: 'goinfra agent', icon: '🔀' },
      { title: 'CSPM baselines', description: 'CIS benchmarks per cloud, identity-posture linting (unused keys, over-permissive roles) and network-exposure graphs.', collector: 'cloud API', icon: '📐' },
      { title: 'Runtime signals', description: 'CloudTrail/Activity Log/ADL streaming for anomalous API behavior — mass downloads, region hops, disabled logging.', collector: 'syslog', icon: '📡' },
      { title: 'Approved auto-fix', description: 'Tenant signs off remediation playbooks once (block-public, rotate-key, detach-power); the platform applies them within minutes of drift.', collector: 'API', icon: '🔧' },
      { title: 'Cost-visible security', description: 'Orphaned volumes, idle LBs and oversized instances flagged with the security AND savings case in one report.', collector: 'cloud API', icon: '💶' },
    ],
    dataStory: {
      headline: 'Least-privilege access to your clouds',
      animation: 'isolation',
      flowNodes: [
        { id: 'aws', label: 'AWS / Azure / GCP', sub: 'your accounts', kind: 'source' },
        { id: 'role', label: 'Read-only role', sub: 'customer-owned, revocable', kind: 'collector' },
        { id: 'eng', label: 'CSPM engine', sub: 'baselines + drift', kind: 'core' },
        { id: 'fix', label: 'Scoped fix role', sub: 'narrow allowlist only', kind: 'sink' },
      ],
      flowEdges: [
        { from: 'aws', to: 'role', label: 'inventory' },
        { from: 'role', to: 'eng', label: 'configs' },
        { from: 'eng', to: 'fix', label: 'approved actions' },
      ],
      bullets: [
        'Two separate roles: one read-only for discovery, one narrow allowlist for remediation — you define what the second may touch.',
        'Either role can be deleted from your cloud console any time; collection stops instantly.',
        'Resource configs are stored hashed + minimized; secret values are never pulled, only existence/rotation metadata.'
      ],
    },
    faqs: [
      { q: 'Which clouds?', a: 'AWS, Azure, GCP and OCI, plus Kubernetes clusters (CIS benchmarks) and Moroccan-local hyperscale regions.' },
      { q: 'Multi-account estates?', a: 'Organizations/root-management integration discovers all member accounts automatically; per-account scoping is optional.' },
      { q: 'Will auto-remediation break prod?', a: 'Nothing auto-fixes without your signed playbook; every action is dry-run first and reversible, with change windows respected.' },
    ],
    gallery: [
      { url: px('1149187'), title: 'Cloud posture map', caption: 'Exposure graphs across accounts and regions' },
      { url: px('430620'), title: 'Drift alarms', caption: 'Secure-by-policy, alerted-by-default' },
      { url: px('708894'), title: 'Identity hygiene', caption: 'Keys, roles and permissions under a microscope' },
    ],
  },
};

// Services in catalog that intentionally have no dedicated rich content yet
export function getServiceContent(id: string): ServiceContent | undefined {
  return serviceContent[id];
}

export function hasAttackScenario(id: string): boolean {
  const c = serviceContent[id];
  return !!c?.protectsFromAttacks && !!c.attackScenario;
}
