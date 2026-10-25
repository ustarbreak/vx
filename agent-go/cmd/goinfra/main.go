// goinfra — InfraCentra infrastructure collection agent.
//
// One static Go binary that installs itself as a service, enrolls with the
// platform over HTTPS using a tenant API token, and then continuously:
//   - inventories the host (CPU/RAM/disk+SMART/network/processes/users/services/packages)
//   - reads IPMI/BMC sensors, FRU serials and SEL via in-band KCS
//   - discovers every device on its networks (TCP sweep + SNMP v1/v2c/v3 + SMB + LLDP)
//   - streams live metrics and pulls scan policy from the platform
//
// Designed for 100% remote deployment: `curl | sh` one-liner or scp of the
// single binary + `goinfra install` — no interactive steps ever needed onsite.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"

	"github.com/infracentra/goinfra-agent/internal/collectors"
	"github.com/infracentra/goinfra-agent/internal/config"
	"github.com/infracentra/goinfra-agent/internal/snmpx"
	"github.com/infracentra/goinfra-agent/internal/state"
	"github.com/infracentra/goinfra-agent/internal/transport"
)

const usage = `goinfra — InfraCentra collection agent %s (%s/%s)

Usage:
  goinfra enroll   --server <url> --token <tenant-api-token>   one-shot enrollment (remote-friendly)
  goinfra run      [--interval 5m] [--scan-cidrs auto]         foreground loop (used by the service)
  goinfra once     [flags]                                     single collect+report cycle, then exit
  goinfra install  [flags]                                     install as systemd unit / Windows service marker
  goinfra check                                                 self-test: prints what it would report
  goinfra status                                                show enrollment + last reports
  goinfra version
`

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("goinfra ")
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, usage, config.AgentVersion, runtime.GOOS, runtime.GOARCH)
		os.Exit(2)
	}
	cmd := os.Args[1]
	args := os.Args[2:]

	var err error
	switch cmd {
	case "enroll":
		err = runEnroll(args)
	case "run", "once":
		err = runAgent(args, cmd == "once")
	case "install":
		err = runInstall(args)
	case "check":
		err = runCheck(args)
	case "status":
		err = runStatus(args)
	case "version", "-v", "--version":
		fmt.Printf("goinfra-agent %s %s/%s\n", config.AgentVersion, runtime.GOOS, runtime.GOARCH)
	default:
		fmt.Fprintf(os.Stderr, usage, config.AgentVersion, runtime.GOOS, runtime.GOARCH)
		os.Exit(2)
	}
	if err != nil {
		log.Fatal(err)
	}
}

// ------------------------------------------------------------------ enroll --

func runEnroll(args []string) error {
	cfg := &config.Config{}
	fs := flag.NewFlagSet("enroll", flag.ExitOnError)
	cfg.BindFlags(fs)
	_ = fs.Parse(args)

	if cfg.Token == "" {
		return fmt.Errorf("--token is required (create one in the platform: Settings → Agents → New API token)")
	}
	hostname, _ := os.Hostname()
	cli := transport.New(cfg.ServerURL, cfg.Token, cfg.InsecureTLS)
	hello, err := cli.Hello(hostname, config.AgentVersion)
	if err != nil {
		return fmt.Errorf("enrollment failed against %s: %w", cfg.ServerURL, err)
	}
	enr := config.Enrollment{
		Server: cfg.ServerURL, Token: cfg.Token,
		AgentID: fmt.Sprint(hello.AgentID), EnrolledAt: time.Now().UTC(),
	}
	if err := config.SaveEnrollment(cfg.StateDir, enr); err != nil {
		return err
	}
	fmt.Printf("✔ enrolled as agent #%d (tenant %d) at %s\n", hello.AgentID, hello.TenantID, cfg.ServerURL)
	fmt.Printf("  state: %s\n", config.EnrollmentPath(cfg.StateDir))
	return nil
}

// -------------------------------------------------------------------- run --

type agent struct {
	cfg   *config.Config
	st    *state.Store
	cli   *transport.Client
	col   *collectors.Collector
	creds []snmpx.Credential

	agentIDNum int
}

func newAgent(cfg *config.Config) (*agent, error) {
	enr, err := config.LoadEnrollment(cfg.StateDir)
	if err != nil {
		return nil, err
	}
	cfg.ServerURL = enr.Server
	cfg.Token = enr.Token
	st := state.New(cfg.StateDir)
	// restore persisted agent id if enroll stored string form
	var aid int
	fmt.Sscanf(enr.AgentID, "%d", &aid)
	a := &agent{
		cfg: cfg, st: st,
		cli: transport.New(enr.Server, enr.Token, cfg.InsecureTLS),
		col: collectors.New(enr.AgentID, cfg.Debug),
	}
	a.agentIDNum = aid
	return a, nil
}

func runAgent(args []string, once bool) error {
	cfg := &config.Config{}
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	cfg.BindFlags(fs)
	_ = fs.Parse(args)
	cfg.Finalize()

	a, err := newAgent(cfg)
	if err != nil {
		return err
	}

	// re-hello to refresh ids and prove token still valid
	hostname, _ := os.Hostname()
	if hello, err := a.cli.Hello(hostname, config.AgentVersion); err == nil {
		a.agentIDNum = hello.AgentID
	} else if once {
		log.Printf("hello failed: %v", err)
	}

	// initial cycles immediately, then ticker
	a.cycle()
	if once {
		return nil
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	tick := time.NewTicker(cfg.Interval)
	metricTick := time.NewTicker(60 * time.Second)
	policyTick := time.NewTicker(15 * time.Minute)
	defer tick.Stop()

	for {
		select {
		case <-sigCh:
			log.Println("shutting down")
			return nil
		case <-tick.C:
			a.cycle()
		case <-metricTick.C:
			a.pushMetrics()
		case <-policyTick.C:
			a.refreshPolicy()
		}
	}
}

// cycle = inventory + discovery + report, each failure isolated.
func (a *agent) cycle() {
	inv := a.col.Collect()
	if err := a.cli.ReportInventory(a.agentIDNum, inv); err != nil {
		log.Printf("inventory upload failed: %v", err)
		_ = a.st.SaveJSON("last_inventory.json", inv) // keep locally for retry visibility
	} else {
		log.Printf("inventory reported (%d disks, %d ifaces)", len(inv.Disks), len(inv.Network))
	}

	disc := collectors.RunDiscovery(a.cfg.ScanCIDRs, a.creds, a.cfg.Debug)
	devs := make([]transport.DiscoveryDevice, 0, len(disc.Devices))
	for _, d := range disc.Devices {
		ports := make([]int, 0, len(d.OpenPorts))
		for _, p := range d.OpenPorts {
			ports = append(ports, int(p.Port))
		}
		devs = append(devs, transport.DiscoveryDevice{
			IP: d.IP, Hostname: d.Hostname, OSGuess: d.OSGuess,
			DeviceType: d.DeviceType, OpenPorts: ports, ViaAgent: a.agentIDNum,
		})
	}
	// enrich with SNMP sysName/sysDescr when available
	for _, f := range disc.SNMPFacts {
		for i := range devs {
			if devs[i].IP == f.IP {
				devs[i].SysName, devs[i].SysDescr = f.SysName, f.SysDescr
			}
		}
	}
	if len(devs) > 0 {
		if err := a.cli.ReportDiscovery(a.agentIDNum, devs); err != nil {
			log.Printf("discovery upload failed: %v", err)
		} else {
			log.Printf("discovery reported %d devices across %v", len(devs), disc.CIDRs)
		}
	}
	_ = a.st.SaveJSON("last_discovery.json", disc)
	a.pushMetrics()
}

func (a *agent) pushMetrics() {
	p := transport.MetricsPoint{TS: time.Now().Unix()}
	if pct, err := cpu.Percent(0, false); err == nil && len(pct) > 0 {
		p.CPUPercent = pct[0]
	}
	if m, err := mem.VirtualMemory(); err == nil {
		p.MemUsedPct = m.UsedPercent
		p.MemTotalBytes = m.Total
	}
	if l, err := load.Avg(); err == nil && l != nil {
		p.Load1 = l.Load1
	}
	inv := a.col.Collect() // reuse full collector for worst disk/temp/net rates
	worst := 0.0
	for _, d := range inv.Disks {
		if d.UsedPercent > worst {
			worst = d.UsedPercent
		}
	}
	p.DiskWorstPct = worst
	for _, t := range inv.CPU.Temperatures {
		if t.Cel > p.TempMaxC {
			p.TempMaxC = t.Cel
		}
	}
	for _, n := range inv.Network {
		p.NetRecvBps += n.BytesRecvPS
		p.NetSentBps += n.BytesSentPS
	}
	if err := a.cli.PushMetrics(a.agentIDNum, []transport.MetricsPoint{p}); err != nil {
		log.Printf("metrics push failed: %v", err)
	}
}

func (a *agent) refreshPolicy() {
	if !a.cfg.Policy || a.agentIDNum == 0 {
		return
	}
	p, err := a.cli.FetchPolicy(a.agentIDNum)
	if err != nil {
		log.Printf("policy fetch failed: %v", err)
		return
	}
	cids := []string{}
	for _, c := range p.SweepCIDRs {
		cids = append(cids, strings.TrimSpace(c))
	}
	if len(cids) > 0 {
		a.cfg.ScanCIDRs = cids
	}
	a.creds = a.creds[:0]
	for _, c := range p.SNMP {
		a.creds = append(a.creds, snmpx.Credential{
			Name: c.Name, Version: c.Version, Community: c.Community,
			Username: c.Username, AuthProtocol: c.AuthProtocol, AuthPassphrase: c.AuthPassphrase,
			PrivProtocol: c.PrivProtocol, PrivPassphrase: c.PrivPassphrase, Port: c.Port,
		})
	}
	log.Printf("policy updated: cidrs=%v snmp_creds=%d", a.cfg.ScanCIDRs, len(a.creds))
}

// ---------------------------------------------------------------- install --

func runInstall(args []string) error {
	cfg := &config.Config{}
	fs := flag.NewFlagSet("install", flag.ExitOnError)
	cfg.BindFlags(fs)
	_ = fs.Parse(args)
	exe, _ := os.Executable()
	exe, _ = filepath.Abs(exe)

	switch runtime.GOOS {
	case "linux":
		unit := `[Unit]
Description=InfraCentra infrastructure collection agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=` + exe + ` run --state-dir ` + cfg.StateDir + `
Restart=always
RestartSec=10
DynamicUser=no
ProtectHome=read-only
NoNewPrivileges=false
AmbientCapabilities=CAP_NET_RAW CAP_SYS_ADMIN
CapabilityBoundingSet=CAP_NET_RAW CAP_SYS_ADMIN

[Install]
WantedBy=multi-user.target
`
		path := "/etc/systemd/system/goinfra.service"
		if err := os.WriteFile(path, []byte(unit), 0644); err != nil {
			return fmt.Errorf("write %s (need root?): %w", path, err)
		}
		if err := systemctl("daemon-reload"); err != nil {
			return err
		}
		if err := systemctl("enable", "--now", "goinfra.service"); err != nil {
			return err
		}
		fmt.Println("✔ systemd service goinfra installed and started")
	case "windows":
		// Windows: Task Scheduler autostart (no external sc.exe dependency)
		if err := winTaskInstall(exe, cfg.StateDir); err != nil {
			return err
		}
		fmt.Println("✔ scheduled task 'goinfra-agent' created (runs at boot, SYSTEM account)")
	default:
		return fmt.Errorf("service install not supported on %s; use cron/launchd with `goinfra run`", runtime.GOOS)
	}
	return nil
}

func systemctl(a ...string) error {
	// implemented via os/exec to avoid cgo sd-daemon deps
	return runCmd("systemctl", a...)
}

// ------------------------------------------------------------------ check --

func runCheck(args []string) error {
	cfg := &config.Config{}
	fs := flag.NewFlagSet("check", flag.ExitOnError)
	cfg.BindFlags(fs)
	_ = fs.Parse(args)
	cfg.Finalize()

	fmt.Println("== connectivity ==")
	if _, err := config.LoadEnrollment(cfg.StateDir); err != nil {
		fmt.Println("!", err)
	} else {
		a, err := newAgent(cfg)
		if err != nil {
			return err
		}
		if err := a.cli.Heartbeat(a.agentIDNum); err != nil {
			fmt.Println("! heartbeat:", err)
		} else {
			fmt.Println("✔ server reachable, token valid")
		}
		a.refreshPolicy()
		fmt.Printf("✔ snmp credentials loaded: %d\n", len(a.creds))
	}

	fmt.Println("== host ==")
	if hi, err := host.Info(); err == nil {
		fmt.Printf("%s (%s %s, kernel %s, up %ds)\n", hi.Hostname, hi.Platform, hi.PlatformVersion, hi.KernelVersion, hi.Uptime)
	}
	col := collectors.New("check", cfg.Debug)
	inv := col.Collect()
	fmt.Printf("cpu %v%% | mem %.1f%% | disks %d | ifaces %d | procs %d | users %d | services %d | packages %d\n",
		inv.CPU.UsagePercent, inv.Memory.UsedPercent, len(inv.Disks), len(inv.Network), len(inv.Processes), len(inv.Users), len(inv.Services), len(inv.Packages))
	if inv.IPMI != nil && inv.IPMI.Available {
		fmt.Printf("ipmi: bmc %s, %d sensors, %d sel entries, fru serial %q\n",
			inv.IPMI.BMCVersion, len(inv.IPMI.Sensors), len(inv.IPMI.SELRecent), inv.IPMI.FruSerial)
	} else {
		fmt.Println("ipmi: not available in-band (ok for VMs)")
	}

	fmt.Println("== local discovery (auto CIDRs) ==")
	res := collectors.RunDiscovery(cfg.ScanCIDRs, nil, cfg.Debug)
	fmt.Printf("scanned %v -> %d live hosts\n", res.CIDRs, len(res.Devices))
	for i, d := range res.Devices {
		if i >= 10 {
			fmt.Printf("... and %d more\n", len(res.Devices)-i)
			break
		}
		svcs := make([]string, 0, len(d.OpenPorts))
		for _, p := range d.OpenPorts {
			svcs = append(svcs, fmt.Sprintf("%d/%s", p.Port, p.Service))
		}
		fmt.Printf("  %-15s %-20s %-12s %s\n", d.IP, d.Hostname, d.OSGuess, strings.Join(svcs, ","))
	}
	return nil
}

// ----------------------------------------------------------------- status --

func runStatus(args []string) error {
	fs := flag.NewFlagSet("status", flag.ExitOnError)
	stateDir := fs.String("state-dir", envOr("GOINFRA_STATE_DIR", config.DefaultStateDir), "state dir")
	_ = fs.Parse(args)
	enr, err := config.LoadEnrollment(*stateDir)
	if err != nil {
		return err
	}
	fmt.Printf("server:   %s\nagent_id: %s\ntoken:    %s\nsince:    %s\n",
		enr.Server, enr.AgentID, maskToken(enr.Token), enr.EnrolledAt.Format(time.RFC3339))
	var last map[string]interface{}
	if ok, _ := state.New(*stateDir).LoadJSON("last_discovery.json", &last); ok {
		fmt.Println("last discovery cached: yes")
	}
	return nil
}

func maskToken(t string) string {
	if len(t) <= 8 {
		return "****"
	}
	return t[:4] + "…" + t[len(t)-4:]
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
