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

	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 64) // 64 hosts in flight

	for _, cidr := range resolved {
		hosts, err := CIDRHosts(cidr)
		if err != nil {
			log.Printf("[discovery] skip %s: %v", cidr, err)
			continue
		}
		for _, ip := range hosts {
			wg.Add(1)
			go func(ip string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				h := SweepHost(ip, CommonServicePorts, 800*time.Millisecond)
				if h == nil {
					return
				}
				// enrich Windows/SMB hosts with announced server name
				if sn, osv, ok := SMBHostInfo(ip); ok {
					if h.Hostname == "" {
						h.Hostname = sn
					}
					if h.OSGuess == "" {
						h.OSGuess = osv
					}
				}
				mu.Lock()
				res.Devices = append(res.Devices, *h)
				mu.Unlock()
			}(ip)
		}
	}
	wg.Wait()

	// SNMP second pass on hosts that answered on 161
	if len(creds) > 0 {
		for i := range res.Devices {
			d := &res.Devices[i]
			hasSNMP := false
			for _, p := range d.OpenPorts {
				if p.Port == 161 {
					hasSNMP = true
					break
				}
			}
			if !hasSNMP {
				continue
			}
			f, err := snmpx.Probe(d.IP, creds, 2*time.Second)
			if err != nil {
				if debug {
					log.Printf("[discovery] snmp %s: %v", d.IP, err)
				}
				continue
			}
			mu.Lock()
			res.SNMPFacts = append(res.SNMPFacts, f)
			mu.Unlock()
			if f.SysName != "" {
				d.Hostname = f.SysName
			}
			if d.DeviceType == "" || d.DeviceType == "unknown" {
				d.DeviceType = deviceTypeFromOID(f.SysObjectID, f.SysDescr)
			}
		}
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
