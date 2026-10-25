// Package collectors gathers a full inventory snapshot of the host and its
// reachable network. Everything is pure Go (gopsutil + gobfreeipmi + our own
// SNMP/SMB/LLDP stacks) so one static binary runs on any Linux distro,
// Windows or macOS without installing anything else on the client site.
package collectors

import "time"

// Inventory is the payload POSTed to /api/agent/inventory each cycle.
type Inventory struct {
	AgentID     string        `json:"agent_id"`
	Hostname    string        `json:"hostname"`
	CollectedAt time.Time     `json:"collected_at"`
	AgentVer    string        `json:"agent_version"`
	System      SystemInfo    `json:"system"`
	CPU         CPUInfo       `json:"cpu"`
	Memory      MemoryInfo    `json:"memory"`
	Disks       []DiskInfo    `json:"disks"`
	Network     []NetIface    `json:"network"`
	Processes   []ProcessInfo `json:"processes,omitempty"`
	Services    []ServiceInfo `json:"services,omitempty"`
	Users       []UserInfo    `json:"users,omitempty"`
	Packages    []PackageInfo `json:"packages,omitempty"`
	IPMI        *IPMIInfo     `json:"ipmi,omitempty"`
	Ports       []PortInfo    `json:"ports,omitempty"`
}

type SystemInfo struct {
	Manufacturer  string `json:"manufacturer"`
	ProductName   string `json:"product_name"`
	SerialNumber  string `json:"serial_number"`
	UUID          string `json:"uuid"`
	OS            string `json:"os"`
	Platform      string `json:"platform"`
	PlatformVer   string `json:"platform_version"`
	KernelVer     string `json:"kernel_version"`
	Arch          string `json:"arch"`
	Virtualized   string `json:"virtualization_role"`
	VirtualGuest  string `json:"virtualization_guest"`
	BootTime      int64  `json:"boot_time"`
	UptimeSeconds uint64 `json:"uptime_seconds"`
	NtpOffset     int64  `json:"ntp_offset_ms,omitempty"`
	Timezone      string `json:"timezone"`
}

type CPUInfo struct {
	Vendor        string    `json:"vendor"`
	Model         string    `json:"model"`
	PhysicalCores int       `json:"physical_cores"`
	LogicalCores  int       `json:"logical_cores"`
	UsagePercent  float64   `json:"usage_percent"`
	FrequencyMHz  float64   `json:"frequency_mhz"`
	Temperatures  []TempSen `json:"temperatures,omitempty"`
}

type TempSen struct {
	Path string  `json:"path"`
	Cel  float64 `json:"celsius"`
	High float64 `json:"high,omitempty"`
	Crit float64 `json:"critical,omitempty"`
}

type MemoryInfo struct {
	TotalBytes     uint64  `json:"total_bytes"`
	AvailableBytes uint64  `json:"available_bytes"`
	UsedPercent    float64 `json:"used_percent"`
	SwapTotal      uint64  `json:"swap_total"`
	SwapUsedPct    float64 `json:"swap_used_percent"`
}

type DiskInfo struct {
	Device      string  `json:"device"`
	Mountpoint  string  `json:"mountpoint"`
	Fstype      string  `json:"fstype"`
	TotalBytes  uint64  `json:"total_bytes"`
	UsedBytes   uint64  `json:"used_bytes"`
	UsedPercent float64 `json:"used_percent"`
	ReadsPerS   float64 `json:"reads_per_sec"`
	WritesPerS  float64 `json:"writes_per_sec"`
	Smart       *SMART  `json:"smart,omitempty"`
}

type SMART struct {
	OverallStatus string `json:"overall_status"` // PASSED|FAILED|UNKNOWN
	TempCelsius   int    `json:"temp_celsius,omitempty"`
	WearLeveling  int    `json:"wear_leveling_pct,omitempty"`
	PowerOnHours  int    `json:"power_on_hours,omitempty"`
	BadSectors    int    `json:"reallocated_sectors,omitempty"`
	Serial        string `json:"serial,omitempty"`
	Model         string `json:"model,omitempty"`
	Firmware      string `json:"firmware,omitempty"`
	Raw           string `json:"raw,omitempty"`
}

type NetIface struct {
	Name         string         `json:"name"`
	MAC          string         `json:"mac"`
	IPv4         []string       `json:"ipv4"`
	IPv6         []string       `json:"ipv6"`
	MTU          int            `json:"mtu"`
	Up           bool           `json:"up"`
	SpeedMbps    float64        `json:"speed_mbps"`
	BytesRecvPS  float64        `json:"bytes_recv_per_sec"`
	BytesSentPS  float64        `json:"bytes_sent_per_sec"`
	PktsErrIn    uint64         `json:"packets_err_in"`
	PktsErrOut   uint64         `json:"packets_err_out"`
	LLDP         []LLDPNeighbor `json:"lldp_neighbors,omitempty"`
	DefaultRoute bool           `json:"default_route"`
}

type LLDPNeighbor struct {
	ChassisID string `json:"chassis_id"`
	PortID    string `json:"port_id"`
	SysName   string `json:"system_name"`
	SysDescr  string `json:"system_description"`
	MgmtAddr  string `json:"mgmt_address,omitempty"`
}

type ProcessInfo struct {
	Pid         int32   `json:"pid"`
	Name        string  `json:"name"`
	User        string  `json:"user"`
	CPUPercent  float64 `json:"cpu_percent"`
	MemRSSBytes uint64  `json:"mem_rss_bytes"`
	State       string  `json:"state"`
	Started     int64   `json:"started_at,omitempty"`
}

type ServiceInfo struct {
	Name     string `json:"name"`
	State    string `json:"state"` // running|stopped|failed
	Enabled  *bool  `json:"enabled,omitempty"`
	Autoload string `json:"autoload,omitempty"`
}

type UserInfo struct {
	Username  string `json:"username"`
	UID       string `json:"uid"`
	GID       string `json:"gid"`
	Shell     string `json:"shell"`
	Home      string `json:"home"`
	IsAdmin   bool   `json:"is_admin"`
	LastLogin int64  `json:"last_login,omitempty"`
}

type PackageInfo struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	Ecosystem string `json:"ecosystem"` // deb|rpm|apk|win|pip|npm
}

type IPMIInfo struct {
	Available  bool            `json:"available"`
	FruChassis string          `json:"fru_chassis,omitempty"`
	FruBoard   string          `json:"fru_board,omitempty"`
	FruProduct string          `json:"fru_product,omitempty"`
	FruSerial  string          `json:"fru_serial,omitempty"`
	BMCVersion string          `json:"bmc_version,omitempty"`
	Sensors    []SensorReading `json:"sensors,omitempty"`
	SELRecent  []SELEntry      `json:"sel_recent,omitempty"`
	Error      string          `json:"error,omitempty"`
}

type SensorReading struct {
	Name   string  `json:"name"`
	Type   string  `json:"type"` // temperature|fan|voltage|current
	Value  float64 `json:"value"`
	Unit   string  `json:"unit"`
	Status string  `json:"status"` // ok|warning|critical|na
}

type SELEntry struct {
	ID     uint16 `json:"id"`
	Time   int64  `json:"time"`
	Type   string `json:"type"`
	Sensor string `json:"sensor"`
	Event  string `json:"event"`
}

type PortInfo struct {
	Proto string `json:"proto"` // tcp|udp
	Local string `json:"local"`
	Pid   int32  `json:"pid,omitempty"`
	Name  string `json:"process,omitempty"`
}
