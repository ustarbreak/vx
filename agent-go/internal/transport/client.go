// Package transport implements the HTTPS client for the InfraCentra platform
// agent API: enrollment handshake, inventory reporting, metric streaming,
// policy fetch and discovery upload. All calls are Bearer-token authenticated
// with TLS verification on by default (--insecure exists only for lab servers).
package transport

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"runtime"
	"strings"
	"time"
)

type Client struct {
	Base  string
	Token string
	HTTP  *http.Client
}

func New(base, token string, insecure bool) *Client {
	tr := &http.Transport{}
	if insecure {
		tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	return &Client{
		Base:  strings.TrimRight(base, "/"),
		Token: token,
		HTTP:  &http.Client{Timeout: 30 * time.Second, Transport: tr},
	}
}

func (c *Client) do(method, path string, body interface{}, out interface{}) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.Base+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "goinfra-agent/1.0")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 400 {
		return fmt.Errorf("%s %s -> %d: %s", method, path, resp.StatusCode, strings.TrimSpace(string(data)))
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

// HelloResponse comes back from POST /api/agent/hello during enroll.
type HelloResponse struct {
	AgentID    int    `json:"agent_id"`
	TenantID   int    `json:"tenant_id"`
	Hostname   string `json:"hostname"`
	Status     string `json:"status"`
	ServerTime string `json:"server_time"`
}

// Hello performs the enrollment handshake; idempotent server-side.
func (c *Client) Hello(hostname, version string) (*HelloResponse, error) {
	var out HelloResponse
	err := c.do("POST", "/api/agent/hello", map[string]string{
		"hostname": hostname, "agent_version": version,
		"os": runtime.GOOS, "ip": primaryIP(),
	}, &out)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// primaryIP returns the main non-loopback unicast address of this host
// (best-effort, used only for fleet display).
func primaryIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok && !ipn.IP.IsLoopback() {
			if v4 := ipn.IP.To4(); v4 != nil {
				return v4.String()
			}
		}
	}
	return ""
}

// Heartbeat keeps the agent marked online.
func (c *Client) Heartbeat(agentID int) error {
	return c.do("POST", fmt.Sprintf("/api/agent/%d/heartbeat", agentID),
		map[string]int64{"ts": time.Now().Unix()}, nil)
}

// ReportInventory uploads a full host snapshot.
func (c *Client) ReportInventory(agentID int, inv interface{}) error {
	return c.do("POST", fmt.Sprintf("/api/agent/%d/inventory", agentID), inv, nil)
}

// MetricsPoint is one sample of the live metrics stream.
type MetricsPoint struct {
	TS            int64   `json:"ts"`
	CPUPercent    float64 `json:"cpu_percent"`
	MemUsedPct    float64 `json:"mem_used_percent"`
	MemTotalBytes uint64  `json:"mem_total_bytes"`
	DiskWorstPct  float64 `json:"disk_worst_percent"`
	Load1         float64 `json:"load1"`
	NetRecvBps    float64 `json:"net_recv_bps"`
	NetSentBps    float64 `json:"net_sent_bps"`
	TempMaxC      float64 `json:"temp_max_celsius"`
}

// PushMetrics streams a batch of samples.
func (c *Client) PushMetrics(agentID int, points []MetricsPoint) error {
	return c.do("POST", fmt.Sprintf("/api/agent/%d/metrics", agentID),
		map[string]interface{}{"points": points}, nil)
}

// SNMPCredential mirrors a tenant SnmpCredential row handed down by policy.
type SNMPCredential struct {
	Name           string `json:"name"`
	Version        string `json:"version"`
	Community      string `json:"community"`
	Username       string `json:"username"`
	AuthProtocol   string `json:"auth_protocol"`
	AuthPassphrase string `json:"auth_passphrase"`
	PrivProtocol   string `json:"priv_protocol"`
	PrivPassphrase string `json:"priv_passphrase"`
	Port           uint16 `json:"port"`
}

// Policy is the scan configuration the platform hands to agents.
type Policy struct {
	SweepCIDRs  []string         `json:"sweep_cidrs"`
	SNMP        []SNMPCredential `json:"snmp_credentials"`
	IntervalSec int              `json:"interval_seconds"`
}

// FetchPolicy pulls sweep targets + SNMP credentials for this tenant.
func (c *Client) FetchPolicy(agentID int) (*Policy, error) {
	var p Policy
	if err := c.do("GET", fmt.Sprintf("/api/agent/%d/policy", agentID), nil, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// DiscoveryDevice is one found host reported into the discovery queue.
type DiscoveryDevice struct {
	IP         string `json:"ip"`
	MAC        string `json:"mac,omitempty"`
	Hostname   string `json:"hostname,omitempty"`
	OSGuess    string `json:"os_guess,omitempty"`
	DeviceType string `json:"device_type,omitempty"`
	OpenPorts  []int  `json:"open_ports,omitempty"`
	SysName    string `json:"sys_name,omitempty"`
	SysDescr   string `json:"sys_descr,omitempty"`
	ViaAgent   int    `json:"via_agent"`
}

// ReportDiscovery uploads discovered devices.
func (c *Client) ReportDiscovery(agentID int, devices []DiscoveryDevice) error {
	return c.do("POST", fmt.Sprintf("/api/agent/%d/discovery", agentID),
		map[string]interface{}{"devices": devices}, nil)
}
