// Package snmpx is a dependency-free SNMP client (v1, v2c and v3 with
// authPriv) built on gosnmp. It powers both the local host self-check and
// the network discovery sweep: sysDescr/sysName/sysUptime queries plus
// credential matching against tenant SNMP credentials.
package snmpx

import (
	"fmt"
	"strings"
	"time"

	"github.com/gosnmp/gosnmp"
)

// Credential mirrors a tenant SnmpCredential row from the platform.
type Credential struct {
	Name           string `json:"name"`
	Version        string `json:"version"` // v1|v2c|v3
	Community      string `json:"community"`
	Username       string `json:"username"`
	AuthProtocol   string `json:"auth_protocol"` // MD5|SHA|SHA256
	AuthPassphrase string `json:"auth_passphrase"`
	PrivProtocol   string `json:"priv_protocol"` // DES|AES128|AES256
	PrivPassphrase string `json:"priv_passphrase"`
	Port           uint16 `json:"port"`
}

// DeviceFacts is what we learn about a device over SNMP.
type DeviceFacts struct {
	IP          string          `json:"ip"`
	SysDescr    string          `json:"sys_descr"`
	SysName     string          `json:"sys_name"`
	SysObjectID string          `json:"sys_objectid"`
	UptimeTicks int64           `json:"uptime_ticks"`
	MatchedCred string          `json:"matched_credential"`
	Interfaces  []SNMPInterface `json:"interfaces,omitempty"`
	ARP         []string        `json:"arp,omitempty"` // ip entries seen in ipNetToMediaTable
}

type SNMPInterface struct {
	Descr string `json:"descr"`
	IP    string `json:"ip"`
	MAC   string `json:"mac"`
	Speed string `json:"speed"`
	State string `json:"state"` // up|down
}

var oids = map[string]string{
	"sysDescr":      "1.3.6.1.2.1.1.1.0",
	"sysObjectID":   "1.3.6.1.2.1.1.2.0",
	"sysUpTime":     "1.3.6.1.2.1.1.3.0",
	"sysName":       "1.3.6.1.2.1.1.5.0",
	"ifDescr":       "1.3.6.1.2.1.2.2.1.2",
	"ifType":        "1.3.6.1.2.1.2.2.1.3",
	"ifSpeed":       "1.3.6.1.2.1.2.2.1.5",
	"ifPhysAddress": "1.3.6.1.2.1.2.2.1.6",
	"ifOperStatus":  "1.3.6.1.2.1.2.2.1.8",
	"ipAdEntAddr":   "1.3.6.1.2.1.4.20.1.1",
	"arpIp":         "1.3.6.1.2.1.4.22.1.3",
}

func buildClient(target string, cred Credential, timeout time.Duration) (*gosnmp.GoSNMP, error) {
	port := cred.Port
	if port == 0 {
		port = 161
	}
	g := &gosnmp.GoSNMP{
		Target:    target,
		Port:      port,
		Timeout:   timeout,
		Retries:   1,
		Community: cred.Community,
	}
	switch strings.ToLower(cred.Version) {
	case "v1":
		g.Version = gosnmp.Version1
	case "v3":
		g.Version = gosnmp.Version3
		g.SecurityModel = gosnmp.UserSecurityModel
		g.MsgFlags = gosnmp.AuthPriv
		if cred.PrivPassphrase == "" {
			g.MsgFlags = gosnmp.AuthNoPriv
		}
		g.SecurityParameters = &gosnmp.UsmSecurityParameters{
			UserName:                 cred.Username,
			AuthenticationProtocol:   authProto(cred.AuthProtocol),
			AuthenticationPassphrase: cred.AuthPassphrase,
			PrivacyProtocol:          privProto(cred.PrivProtocol),
			PrivacyPassphrase:        cred.PrivPassphrase,
		}
	default: // v2c
		g.Version = gosnmp.Version2c
	}
	if err := g.Connect(); err != nil {
		return nil, err
	}
	return g, nil
}

func authProto(s string) gosnmp.SnmpV3AuthProtocol {
	switch strings.ToUpper(strings.ReplaceAll(s, "-", "")) {
	case "MD5":
		return gosnmp.MD5
	case "SHA224":
		return gosnmp.SHA224
	case "SHA256":
		return gosnmp.SHA256
	case "SHA384":
		return gosnmp.SHA384
	case "SHA512":
		return gosnmp.SHA512
	case "", "NONE", "NOAUTH":
		return gosnmp.NoAuth
	default: // SHA / SHA1
		return gosnmp.SHA
	}
}

func privProto(s string) gosnmp.SnmpV3PrivProtocol {
	switch strings.ToUpper(strings.ReplaceAll(s, "-", "")) {
	case "DES":
		return gosnmp.DES
	case "AES256":
		return gosnmp.AES256
	case "AES192":
		return gosnmp.AES192
	case "AES128", "AES":
		return gosnmp.AES
	default:
		return gosnmp.NoPriv
	}
}

// Probe tries every credential against target, returns facts of first match.
func Probe(target string, creds []Credential, timeout time.Duration) (*DeviceFacts, error) {
	var lastErr error
	for _, cred := range creds {
		f, err := probeWith(target, cred, timeout)
		if err != nil {
			lastErr = err
			continue
		}
		return f, nil
	}
	return nil, lastErr
}

func probeWith(target string, cred Credential, timeout time.Duration) (*DeviceFacts, error) {
	g, err := buildClient(target, cred, timeout)
	if err != nil {
		return nil, err
	}
	defer func() {
		if g.Conn != nil {
			g.Conn.Close()
		}
	}()

	res, err := g.Get([]string{oids["sysDescr"], oids["sysObjectID"], oids["sysUpTime"], oids["sysName"]})
	if err != nil {
		return nil, err
	}
	f := &DeviceFacts{IP: target, MatchedCred: cred.Name}
	for _, pdu := range res.Variables {
		v := fmt.Sprint(gosnmp.ToBigInt(pdu.Value))
		switch pdu.Name {
		case "." + oids["sysDescr"]:
			f.SysDescr = toString(pdu)
		case "." + oids["sysName"]:
			f.SysName = toString(pdu)
		case "." + oids["sysObjectID"]:
			f.SysObjectID = strings.TrimPrefix(v, ".")
		case "." + oids["sysUpTime"]:
			if n, ok := pdu.Value.(uint32); ok {
				f.UptimeTicks = int64(n)
			} else if b := gosnmp.ToBigInt(pdu.Value); b != nil {
				f.UptimeTicks = b.Int64()
			}
		}
	}
	// interface table + IPs (best effort, ignore errors)
	idxs := map[string]int{}
	if ifres, err := g.WalkAll(oids["ifDescr"]); err == nil {
		for _, p := range ifres {
			key := strings.TrimPrefix(p.Name, oids["ifDescr"]+".")
			idxs[key] = len(f.Interfaces)
			f.Interfaces = append(f.Interfaces, SNMPInterface{Descr: toString(p)})
		}
		fillCol(g, oids["ifPhysAddress"], idxs, f, func(s *SNMPInterface, v string) { s.MAC = v })
		fillCol(g, oids["ifOperStatus"], idxs, f, func(s *SNMPInterface, v string) {
			if v == "1" {
				s.State = "up"
			} else {
				s.State = "down"
			}
		})
	}
	if ipres, err := g.WalkAll(oids["ipAdEntAddr"]); err == nil {
		for _, p := range ipres {
			idxStr := p.Name[strings.LastIndex(p.Name, ".")+1:]
			var idx int
			fmt.Sscanf(idxStr, "%d", &idx)
			if pos, ok := findIfaceByIndex(idxs, idx); ok {
				f.Interfaces[pos].IP = toString(p)
			}
		}
	}
	if arp, err := g.WalkAll(oids["arpIp"]); err == nil {
		seen := map[string]bool{}
		for _, p := range arp {
			ip := toString(p)
			if ip != "" && !seen[ip] {
				seen[ip] = true
				f.ARP = append(f.ARP, ip)
			}
		}
	}
	return f, nil
}

func findIfaceByIndex(idxs map[string]int, want int) (int, bool) {
	// ifDescr rows are keyed by ifIndex as string
	if pos, ok := idxs[fmt.Sprint(want)]; ok {
		return pos, true
	}
	return 0, false
}

func fillCol(g *gosnmp.GoSNMP, base string, idxs map[string]int, f *DeviceFacts, set func(*SNMPInterface, string)) {
	res, err := g.WalkAll(base)
	if err != nil {
		return
	}
	for _, p := range res {
		key := strings.TrimPrefix(p.Name, base+".")
		if pos, ok := idxs[key]; ok && pos < len(f.Interfaces) {
			set(&f.Interfaces[pos], colValue(p))
		}
	}
}

func colValue(p gosnmp.SnmpPDU) string {
	switch v := p.Value.(type) {
	case string:
		return v
	case []byte:
		hex := fmt.Sprintf("%x", v)
		if len(v) == 6 {
			return strings.Join(splitEvery(hex, 2), ":")
		}
		return hex
	default:
		return fmt.Sprint(v)
	}
}

func toString(p gosnmp.SnmpPDU) string {
	if s, ok := p.Value.(string); ok {
		return s
	}
	if b, ok := p.Value.([]byte); ok {
		return string(b)
	}
	return fmt.Sprint(p.Value)
}

func splitEvery(s string, n int) []string {
	var out []string
	for i := 0; i < len(s); i += n {
		e := i + n
		if e > len(s) {
			e = len(s)
		}
		out = append(out, s[i:e])
	}
	return out
}

// SelfCheck answers basic GETs on localhost — used by `goinfra check`.
func SelfCheck(creds []Credential) []*DeviceFacts {
	var out []*DeviceFacts
	for _, c := range creds {
		if f, err := probeWith("127.0.0.1", c, time.Second); err == nil {
			out = append(out, f)
			break
		}
	}
	return out
}
