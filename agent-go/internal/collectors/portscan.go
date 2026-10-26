package collectors

import (
	"fmt"
	"net"
	"strconv"
	"sync"
	"time"
)

// CommonServicePorts is the default sweep set — mirrors what a light nmap
// top-ports scan would probe, but pure Go and rate-limited.
var CommonServicePorts = []uint16{
	21, 22, 23, 25, 53, 80, 110, 111, 135, 137, 139, 143, 161, 389, 443, 445,
	587, 623, 993, 995, 1433, 1521, 2049, 3306, 3389, 4444, 5432, 5900, 5985,
	6379, 8080, 8443, 9100, 9200, 11211, 27017,
}

// ServiceHint maps well-known ports to service names for device typing.
var ServiceHint = map[uint16]string{
	21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns", 80: "http",
	110: "pop3", 111: "rpcbind", 135: "msrpc", 137: "netbios-ns", 139: "netbios-ssn",
	143: "imap", 161: "snmp", 389: "ldap", 443: "https", 445: "smb",
	587: "submission", 623: "ipmi", 993: "imaps", 995: "pop3s", 1433: "mssql",
	1521: "oracle", 2049: "nfs", 3306: "mysql", 3389: "rdp", 5432: "postgres",
	5900: "vnc", 5985: "winrm", 6379: "redis", 8080: "http-alt", 8443: "https-alt",
	9100: "jetdirect", 9200: "elasticsearch", 11211: "memcached", 27017: "mongodb",
}

// HostResult is one live host found by the sweeper.
type HostResult struct {
	IP         string    `json:"ip"`
	MAC        string    `json:"mac,omitempty"`
	Hostname   string    `json:"hostname,omitempty"`
	OpenPorts  []PortHit `json:"open_ports"`
	LatencyMs  int64     `json:"latency_ms"`
	OSGuess    string    `json:"os_guess,omitempty"`
	DeviceType string    `json:"device_type,omitempty"`
}

type PortHit struct {
	Port    uint16 `json:"port"`
	Service string `json:"service,omitempty"`
}

// SweepHost TCP-connect probes the given ports on ip concurrently.
func SweepHost(ip string, ports []uint16, timeout time.Duration) *HostResult {
	res := &HostResult{IP: ip}
	start := time.Now()
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 32)
	for _, p := range ports {
		wg.Add(1)
		go func(port uint16) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			addr := net.JoinHostPort(ip, strconv.Itoa(int(port)))
			c, err := net.DialTimeout("tcp", addr, timeout)
			if err != nil {
				return
			}
			c.Close()
			mu.Lock()
			res.OpenPorts = append(res.OpenPorts, PortHit{Port: port, Service: ServiceHint[port]})
			mu.Unlock()
		}(p)
	}
	wg.Wait()
	if len(res.OpenPorts) == 0 && time.Since(start) >= timeout {
		return nil // dead host
	}
	res.LatencyMs = time.Since(start).Milliseconds()
	res.OSGuess, res.DeviceType = classifyHost(res.OpenPorts)
	if h, err := net.LookupAddr(ip); err == nil && len(h) > 0 {
		res.Hostname = h[0]
	}
	return res
}

// classifyHost guesses OS/type from the open-port signature (like a mini nmap).
func classifyHost(ports []PortHit) (osGuess, devType string) {
	set := map[uint16]bool{}
	for _, p := range ports {
		set[p.Port] = true
	}
	switch {
	case set[445] || set[135] || set[139] || set[3389]:
		osGuess = "Windows"
	case set[22] && !set[445] && !set[135]:
		osGuess = "Linux/Unix"
	case set[161] && !set[22] && !set[445]:
		osGuess = "Network/Embedded"
	}
	switch {
	case set[9100]:
		devType = "printer"
	case set[161] && (set[23] || set[443]) && !set[22]:
		devType = "network"
	case set[3389] || set[445]:
		devType = "workstation"
	case set[22]:
		devType = "server"
	default:
		devType = "unknown"
	}
	return
}

// CIDRHosts enumerates usable IPv4 hosts of a CIDR (cap at /16).
func CIDRHosts(cidr string) ([]string, error) {
	ip, network, err := net.ParseCIDR(cidr)
	if err != nil {
		// single IP allowed
		if parsed := net.ParseIP(cidr); parsed != nil {
			return []string{parsed.String()}, nil
		}
		return nil, fmt.Errorf("bad CIDR %q", cidr)
	}
	ones, bits := network.Mask.Size()
	if bits-ones > 16 {
		return nil, fmt.Errorf("CIDR %s too large (max /16)", cidr)
	}
	var out []string
	if ones == bits { // /32
		return []string{ip.String()}, nil
	}
	networkIP := network.IP.To4()
	size := 1 << uint(bits-ones)
	for i := 1; i < size-1; i++ {
		v := ipToUint32(networkIP) + uint32(i)
		out = append(out, uint32ToIP(v).String())
	}
	return out, nil
}

func ipToUint32(ip net.IP) uint32 {
	ip = ip.To4()
	return uint32(ip[0])<<24 | uint32(ip[1])<<16 | uint32(ip[2])<<8 | uint32(ip[3])
}

func uint32ToIP(v uint32) net.IP {
	return net.IPv4(byte(v>>24), byte(v>>16), byte(v>>8), byte(v))
}

// LocalCIDRs derives the subnets this machine is attached to ("auto" mode):
// every non-loopback interface's IPv4 network with its actual prefix length.
func LocalCIDRs() []string {
	var out []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil {
				out = append(out, ipn.String())
			}
		}
	}
	return out
}
