# agent-go (goinfra) — Claims vs Code Audit (T0.4)

Source read: `agent-go/cmd/goinfra/main.go`, `internal/{collectors,snmpx,transport,state,config}`. Legend: ✔ verified in code, ✖ absent, ⚠ partial.

## Collectors actually present (`internal/collectors/`)
| Collector | File | Status |
|---|---|---|
| Host inventory (CPU/mem/disk/OS) | host.go, linux.go, osutil.go | ✔ |
| Network discovery / ARP-like | discovery.go | ✔ (reports via `ReportDiscovery`) |
| Port scan | portscan.go | ✔ |
| SNMP | snmpx/snmp.go (11 funcs) | ✔ |
| LLDP | lldp.go + lldp_raw.go; build-tagged stub lldp_stub.go | ✔ raw impl, ⚠ stub fallback on unsupported platforms |
| IPMI | ipmi.go + ipmi_stub.go | ⚠ real path + stub variant (build tags) |
| SMART disk health | smart.go | ✔ |
| SMB enumeration | smb.go | ✔ |

## Transport (`internal/transport/client.go`, 9 funcs)
- Hello/enroll, Heartbeat, ReportInventory, PushMetrics, FetchPolicy, ReportDiscovery — all real HTTP calls to backend `/api/agent/*`.
- **✖ mTLS**: L29 `tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}` — unconditional today. `New(base, token string, insecure bool)` (L26) takes an `insecure` flag but the TLS config above ignores it. Token auth only. **TODO_VERIFY** whether the flag is honored anywhere else; grep shows no other TLS config.
- **✖ retry/backoff queue**: grep for `Retry|retry|queue` in client.go found none — failed POSTs are lost until next tick.

## State & buffering (`internal/state/state.go`)
- ⚠ Only JSON file persistence: `SaveJSON/LoadJSON` under a dir (agent ID, policy cache). No metrics spool/buffer for offline operation — if server is down, `cycle()` results simply aren't delivered (tick loop main.go L172-174: run interval, 60s metrics, 15min policy refresh).

## CLI (`cmd/goinfra/main.go`)
- Commands: `enroll`, `run [--interval] [--scan-cidrs auto]`, `install` (service install, L296), once-mode. Real systemd-style service install present.

## Gap list (feeds Phase 2/3 backlog)
1. Honor `insecure` param → default verify=true behind `CONNECTOR_TLS_VERIFY`-style env (owner decision #5: flag first, flip later). Small.
2. Offline buffer: append failed pushes to state dir JSONL, replay on next cycle. Medium.
3. Retry with backoff in transport.do(). Small.
4. Syslog forwarder: **✖ does not exist** anywhere in agent-go (grep "syslog" = 0 hits) despite brief mentioning log shipping — do not claim it. Out of current scope.
