package collectors

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
	"github.com/shirou/gopsutil/v3/process"
)

// Collector orchestrates one inventory pass.
type Collector struct {
	Debug    bool
	AgentID  string
	maxProcs int
}

func New(agentID string, debug bool) *Collector {
	return &Collector{Debug: debug, AgentID: agentID, maxProcs: 80}
}

// Collect runs every collector and assembles the Inventory payload.
func (c *Collector) Collect() *Inventory {
	inv := &Inventory{
		AgentID:     c.AgentID,
		CollectedAt: time.Now().UTC(),
		AgentVer:    versionString(),
	}
	inv.Hostname, _ = os.Hostname()
	c.collectSystem(inv)
	c.collectCPU(inv)
	c.collectMemory(inv)
	c.collectDisks(inv)
	c.collectNetwork(inv)
	c.collectProcesses(inv)
	c.collectPorts(inv)
	c.collectUsers(inv)
	c.collectServices(inv)
	c.collectPackages(inv)
	c.collectIPMI(inv) // no-op on non-linux / when IPMI unavailable
	if c.Debug {
		log.Printf("[collect] %d disks, %d ifaces, %d procs, ipmi=%v",
			len(inv.Disks), len(inv.Network), len(inv.Processes), inv.IPMI != nil && inv.IPMI.Available)
	}
	return inv
}

func versionString() string { return "goinfra-agent/1.0.0 " + runtime.GOOS + "/" + runtime.GOARCH }

// ---------------------------------------------------------------- system ----

func (c *Collector) collectSystem(inv *Inventory) {
	if hi, err := host.Info(); err == nil {
		s := &inv.System
		s.OS = hi.OS
		s.Platform = hi.Platform
		s.PlatformVer = hi.PlatformVersion
		s.KernelVer = hi.KernelVersion
		s.Arch = hi.KernelArch
		s.Virtualized = hi.VirtualizationSystem
		s.VirtualGuest = hi.VirtualizationRole
		s.BootTime = int64(hi.BootTime)
		s.UptimeSeconds = hi.Uptime
		if b, err := os.ReadFile("/etc/timezone"); err == nil {
			s.Timezone = strings.TrimSpace(string(b))
		}
		if s.Timezone == "" {
			if link, err := os.Readlink("/etc/localtime"); err == nil {
				s.Timezone = strings.TrimPrefix(strings.TrimPrefix(link, "/usr/share/zoneinfo/"), "/")
			}
		}
		if s.Timezone == "" {
			tz, _ := time.Now().In(time.Local).Zone()
			s.Timezone = tz
		}
	}
	readDMI(&inv.System)
	inv.System.NtpOffset = ntpOffsetMs()
}

// ------------------------------------------------------------------ cpu ----

func (c *Collector) collectCPU(inv *Inventory) {
	if info, err := cpu.Info(); err == nil && len(info) > 0 {
		inv.CPU.Vendor = info[0].VendorID
		inv.CPU.Model = strings.TrimSpace(info[0].ModelName)
		inv.CPU.FrequencyMHz = info[0].Mhz
	}
	if phys, err := cpu.Counts(false); err == nil {
		inv.CPU.PhysicalCores = phys
	}
	if logi, err := cpu.Counts(true); err == nil {
		inv.CPU.LogicalCores = logi
	}
	if pct, err := cpu.Percent(300*time.Millisecond, false); err == nil && len(pct) > 0 {
		inv.CPU.UsagePercent = round2(pct[0])
	}
	inv.CPU.Temperatures = readTemperatures()
}

// hwmon temps (Linux). Returns nothing on other platforms.
func readTemperatures() []TempSen {
	var out []TempSen
	base := "/sys/class/hwmon"
	entries, err := os.ReadDir(base)
	if err != nil {
		return nil
	}
	for _, e := range entries {
		dir := filepath.Join(base, e.Name())
		name, _ := os.ReadFile(filepath.Join(dir, "name"))
		high, _ := readIntFile(filepath.Join(dir, "temp1_high"))
		crit, _ := readIntFile(filepath.Join(dir, "temp1_crit"))
		v, err := readIntFile(filepath.Join(dir, "temp1_input"))
		if err != nil {
			continue
		}
		out = append(out, TempSen{
			Path: strings.TrimSpace(string(name)),
			Cel:  round2(float64(v) / 1000.0),
			High: round2(float64(high) / 1000.0),
			Crit: round2(float64(crit) / 1000.0),
		})
	}
	return out
}

// --------------------------------------------------------------- memory ----

func (c *Collector) collectMemory(inv *Inventory) {
	if m, err := mem.VirtualMemory(); err == nil {
		inv.Memory.TotalBytes = m.Total
		inv.Memory.AvailableBytes = m.Available
		inv.Memory.UsedPercent = round2(m.UsedPercent)
	}
	if sw, err := mem.SwapMemory(); err == nil {
		inv.Memory.SwapTotal = sw.Total
		if sw.Total > 0 {
			inv.Memory.SwapUsedPct = round2(sw.UsedPercent)
		}
	}
}

// ----------------------------------------------------------------- disks ----

func (c *Collector) collectDisks(inv *Inventory) {
	parts, err := disk.Partitions(false)
	if err != nil {
		return
	}
	ioBefore, errIO := disk.IOCounters()
	for _, p := range parts {
		switch p.Fstype {
		case "proc", "sysfs", "devtmpfs", "devpts", "tmpfs", "cgroup", "cgroup2",
			"overlay", "squashfs", "autofs", "mqueue", "hugetlbfs", "debugfs",
			"securityfs", "pstore", "binfmt_misc", "configfs", "fusectl",
			"tracefs", "efivarfs", "bpf", "ramfs":
			continue
		}
		u, err := disk.Usage(p.Mountpoint)
		if err != nil || u.Total == 0 {
			continue
		}
		inv.Disks = append(inv.Disks, DiskInfo{
			Device: p.Device, Mountpoint: p.Mountpoint, Fstype: p.Fstype,
			TotalBytes: u.Total, UsedBytes: u.Used, UsedPercent: round2(u.UsedPercent),
		})
	}
	if errIO == nil && len(inv.Disks) > 0 {
		time.Sleep(250 * time.Millisecond)
		ioAfter, err := disk.IOCounters()
		if err == nil {
			for i := range inv.Disks {
				dev := baseName(inv.Disks[i].Device)
				b, ok1 := ioBefore[dev]
				a, ok2 := ioAfter[dev]
				if ok1 && ok2 {
					const dt = 0.25
					inv.Disks[i].ReadsPerS = round2(float64(a.ReadCount-b.ReadCount) / dt)
					inv.Disks[i].WritesPerS = round2(float64(a.WriteCount-b.WriteCount) / dt)
				}
			}
		}
	}
	c.collectSMART(inv)
}

func baseName(dev string) string {
	i := strings.LastIndex(dev, "/")
	if i >= 0 {
		return dev[i+1:]
	}
	return dev
}

// -------------------------------------------------------------- network ----

func (c *Collector) collectNetwork(inv *Inventory) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return
	}
	before, _ := net.IOCounters(true)
	defIfaces := defaultRouteIfaces()
	time.Sleep(200 * time.Millisecond)
	after, _ := net.IOCounters(true)
	rate := map[string][2]float64{}
	am := map[string]int{}
	for i, a := range after {
		am[a.Name] = i
	}
	for _, b := range before {
		if idx, ok := am[b.Name]; ok {
			rate[b.Name] = [2]float64{
				float64(after[idx].BytesRecv-b.BytesRecv) / 0.2,
				float64(after[idx].BytesSent-b.BytesSent) / 0.2,
			}
		}
	}

	for _, ifc := range ifaces {
		var v4, v6 []string
		for _, a := range ifc.Addrs {
			ip := strings.SplitN(a.Addr, "/", 2)[0]
			if strings.Contains(ip, ":") {
				v6 = append(v6, ip)
			} else {
				v4 = append(v4, ip)
			}
		}
		up := false
		for _, fl := range ifc.Flags {
			if fl == "FlagUp" {
				up = true
			}
		}
		n := NetIface{
			Name: ifc.Name, MAC: ifc.HardwareAddr, IPv4: v4, IPv6: v6,
			MTU: ifc.MTU, Up: up,
			DefaultRoute: defIfaces[strings.ToLower(ifc.Name)],
		}
		if r, ok := rate[ifc.Name]; ok {
			n.BytesRecvPS = round2(r[0])
			n.BytesSentPS = round2(r[1])
		}
		n.SpeedMbps = linkSpeedMbps(ifc.Name)
		if n.Up && runtime.GOOS == "linux" {
			n.LLDP = lldpNeighbors(ifc.Name)
		}
		inv.Network = append(inv.Network, n)
	}
}

func defaultRouteIfaces() map[string]bool {
	out := map[string]bool{}
	if runtime.GOOS == "linux" {
		// parse /proc/net/route (hex 00000000 destination)
		b, err := os.ReadFile("/proc/net/route")
		if err == nil {
			for _, line := range strings.Split(string(b), "\n")[1:] {
				f := strings.Fields(line)
				if len(f) >= 3 && f[1] == "00000000" {
					out[strings.ToLower(f[0])] = true
				}
			}
		}
	}
	return out
}

// ------------------------------------------------------------- processes ----

func (c *Collector) collectProcesses(inv *Inventory) {
	procs, err := process.Processes()
	if err != nil {
		return
	}
	type row struct{ p ProcessInfo }
	rows := make([]row, 0, len(procs))
	uidNames := map[string]string{}
	resolveUser := func(uid string) string {
		if nm, ok := uidNames[uid]; ok {
			return nm
		}
		nm := lookupUserName(uid)
		uidNames[uid] = nm
		return nm
	}
	for _, pr := range procs {
		name, err := pr.Name()
		if err != nil || name == "" {
			continue
		}
		cpuPct, _ := pr.CPUPercent()
		mi, _ := pr.MemoryInfo()
		st, _ := pr.Status()
		state := "?"
		if len(st) > 0 {
			state = st[0]
		}
		uids, _ := pr.Uids()
		usr := ""
		if len(uids) > 0 {
			usr = resolveUser(strconv.FormatInt(int64(uids[0]), 10))
		}
		var rss uint64
		if mi != nil {
			rss = mi.RSS
		}
		started, _ := pr.CreateTime()
		rows = append(rows, row{ProcessInfo{
			Pid: pr.Pid, Name: name, User: usr, CPUPercent: round2(cpuPct),
			MemRSSBytes: rss, State: state, Started: started / 1000,
		}})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].p.MemRSSBytes > rows[j].p.MemRSSBytes })
	if len(rows) > c.maxProcs {
		rows = rows[:c.maxProcs]
	}
	for _, r := range rows {
		inv.Processes = append(inv.Processes, r.p)
	}
}

// ---------------------------------------------------------------- ports ----

func (c *Collector) collectPorts(inv *Inventory) {
	conns, err := net.Connections("all")
	if err != nil {
		return
	}
	seen := map[string]bool{}
	nameByPid := map[int32]string{}
	for _, p := range inv.Processes {
		nameByPid[p.Pid] = p.Name
	}
	for _, cn := range conns {
		// listening TCP or bound UDP only
		if cn.Type == 2 /*tcp*/ && cn.Status != "LISTEN" {
			continue
		}
		if cn.Type != 2 && cn.Type != 1 /*udp*/ {
			continue
		}
		if cn.Laddr.Port == 0 {
			continue
		}
		proto := "tcp"
		if cn.Type == 1 {
			proto = "udp"
		}
		local := fmt.Sprintf("%s:%d", cn.Laddr.IP, cn.Laddr.Port)
		key := proto + "|" + local
		if seen[key] {
			continue
		}
		seen[key] = true
		inv.Ports = append(inv.Ports, PortInfo{
			Proto: proto, Local: local, Pid: cn.Pid, Name: nameByPid[cn.Pid],
		})
	}
}

// ---------------------------------------------------------------- users ----

func (c *Collector) collectUsers(inv *Inventory) {
	inv.Users = listUsers()
}

// ---------------------------------------------------------------- helpers --

func readIntFile(path string) (int64, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64)
}

func round2(f float64) float64 {
	return float64(int64(f*100+0.5)) / 100
}
