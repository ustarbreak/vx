package collectors

import (
	"log"
	"sync"
	"time"

	"github.com/infracentra/goinfra-agent/internal/snmpx"
)

// DiscoveryResult is one pass of network discovery, ready to upload.
type DiscoveryResult struct {
	RanAt     time.Time            `json:"ran_at"`
	CIDRs     []string             `json:"cidrs"`
	Devices   []HostResult         `json:"devices"`
	SNMPFacts []*snmpx.DeviceFacts `json:"snmp_facts,omitempty"`
}

// RunDiscovery resolves CIDRs ("auto" -> local subnets), TCP-sweeps each host
// on the common service ports, then SNMP-probes anything answering on 161
// using tenant credentials. Concurrency is bounded so a /24 finishes in ~30s
// without flooding the client's network — safe for fully remote execution.
func RunDiscovery(cidrs []string, creds []snmpx.Credential, debug bool) *DiscoveryResult {
	resolved := []string{}
	for _, c := range cidrs {
		if c == "auto" {
			resolved = append(resolved, LocalCIDRs()...)
		} else {
			resolved = append(resolved, c)
		}
	}
	res := &DiscoveryResult{RanAt: time.Now().UTC(), CIDRs: resolved}

	// Fixed-size workers avoid creating tens of thousands of goroutines for a
	// customer /16. Each worker performs a bounded TCP sweep for one host.
	hostJobs := make(chan string, 128)
	var hostWG sync.WaitGroup
	var resultMu sync.Mutex
	for worker := 0; worker < 24; worker++ {
		hostWG.Add(1)
		go func() {
			defer hostWG.Done()
			for ip := range hostJobs {
				h := SweepHost(ip, CommonServicePorts, 800*time.Millisecond)
				if h == nil { continue }
				if sn, osv, ok := SMBHostInfo(ip); ok {
					if h.Hostname == "" { h.Hostname = sn }
					if h.OSGuess == "" { h.OSGuess = osv }
				}
				resultMu.Lock()
				res.Devices = append(res.Devices, *h)
				resultMu.Unlock()
			}
		}()
	}

	allIPs := make([]string, 0)
	for _, cidr := range resolved {
		hosts, err := CIDRHosts(cidr)
		if err != nil {
			log.Printf("[discovery] skip %s: %v", cidr, err)
			continue
		}
		allIPs = append(allIPs, hosts...)
		for _, ip := range hosts { hostJobs <- ip }
	}
	close(hostJobs)
	hostWG.Wait()

	// SNMP is UDP/161. It must be probed independently of TCP discovery,
	// otherwise SNMP-only switches/printers are invisible. Bounded workers
	// keep broad approved subnets from exhausting the agent or client network.
	if len(creds) > 0 {
		snmpJobs := make(chan string, 128)
		var snmpWG sync.WaitGroup
		for worker := 0; worker < 16; worker++ {
			snmpWG.Add(1)
			go func() {
				defer snmpWG.Done()
				for ip := range snmpJobs {
					f, err := snmpx.Probe(ip, creds, 500*time.Millisecond)
					if err != nil {
						if debug { log.Printf("[discovery] snmp %s: %v", ip, err) }
						continue
					}
					resultMu.Lock()
					res.SNMPFacts = append(res.SNMPFacts, f)
					found := false
					for i := range res.Devices {
						if res.Devices[i].IP == ip {
							found = true
							if f.SysName != "" { res.Devices[i].Hostname = f.SysName }
							if res.Devices[i].DeviceType == "" || res.Devices[i].DeviceType == "unknown" {
								res.Devices[i].DeviceType = deviceTypeFromOID(f.SysObjectID, f.SysDescr)
							}
							break
						}
					}
					if !found {
						res.Devices = append(res.Devices, HostResult{
							IP: ip, Hostname: f.SysName,
							OSGuess: "network/embedded",
							DeviceType: deviceTypeFromOID(f.SysObjectID, f.SysDescr),
						})
					}
					resultMu.Unlock()
				}
			}()
		}
		for _, ip := range allIPs { snmpJobs <- ip }
		close(snmpJobs)
		snmpWG.Wait()
	}
	return res
}

// deviceTypeFromOID maps enterprise OIDs to friendly types (mini vendor DB).
func deviceTypeFromOID(oid, descr string) string {
	l := lowerAll(oid + " " + descr)
	switch {
	case containsAny(l, "cisco", "juniper", "arista", "mikrotik", "ubiquiti", "ruckus", "aruba"):
		return "network"
	case containsAny(l, "hp", "hewlett", "canon", "epson", "brother", "xerox", "ricoh"):
		return "printer"
	case containsAny(l, "synology", "qnap", "netgear", "treasure"):
		return "nas"
	case containsAny(l, "esxi", "vmware", "proxmox", "pve"):
		return "hypervisor"
	case containsAny(l, "dell", "hp", "lenovo", "supermicro", "intel") && containsAny(l, "poweredge", "proliant", "server"):
		return "server"
	}
	return "unknown"
}

func lowerAll(s string) string {
	b := []byte(s)
	for i := range b {
		if b[i] >= 'A' && b[i] <= 'Z' {
			b[i] += 32
		}
	}
	return string(b)
}

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if idxOf(s, sub) >= 0 {
			return true
		}
	}
	return false
}

func idxOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
