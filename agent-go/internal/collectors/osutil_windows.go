//go:build windows

package collectors

import (
	"context"
	"encoding/json"
	"os/exec"
	"os/user"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const powershellTimeout = 20 * time.Second

func runPowerShell(script string, out interface{}) error {
	ctx, cancel := context.WithTimeout(context.Background(), powershellTimeout)
	defer cancel()
	data, err := exec.CommandContext(ctx, "powershell.exe", "-NoLogo", "-NoProfile",
		"-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script).Output()
	if err != nil { return err }
	if out == nil || len(strings.TrimSpace(string(data))) == 0 { return nil }
	if err := json.Unmarshal(data, out); err != nil {
		v := reflect.ValueOf(out)
		if v.Kind() == reflect.Ptr && v.Elem().Kind() == reflect.Slice && strings.HasPrefix(strings.TrimSpace(string(data)), "{") {
			wrapped := append([]byte("["), data...)
			wrapped = append(wrapped, ']')
			return json.Unmarshal(wrapped, out)
		}
		return err
	}
	return nil
}

func readDMI(s *SystemInfo) {
	var row struct {
		Manufacturer string `json:"Manufacturer"`
		Name string `json:"Name"`
		Serial string `json:"IdentifyingNumber"`
		UUID string `json:"UUID"`
	}
	if err := runPowerShell("Get-CimInstance Win32_ComputerSystemProduct | Select-Object Manufacturer,Name,IdentifyingNumber,UUID | ConvertTo-Json -Compress", &row); err == nil {
		s.Manufacturer, s.ProductName, s.SerialNumber, s.UUID = row.Manufacturer, row.Name, row.Serial, row.UUID
	}
}

func ntpOffsetMs() int64 {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "w32tm.exe", "/query", "/status").CombinedOutput()
	if err != nil { return 0 }
	re := regexp.MustCompile(`(?i)offset:\s*([+-]?[0-9]+(?:\.[0-9]+)?)s`)
	match := re.FindStringSubmatch(string(out))
	if len(match) != 2 { return 0 }
	v, err := strconv.ParseFloat(match[1], 64)
	if err != nil { return 0 }
	return int64(v * 1000)
}

var (
	linkOnce sync.Once
	linkCache map[string]float64
)

func linkSpeedMbps(name string) float64 {
	linkOnce.Do(func() {
		linkCache = map[string]float64{}
		var rows []struct {
			Name string `json:"Name"`
			LinkSpeed string `json:"LinkSpeed"`
		}
		if runPowerShell("Get-NetAdapter | Select-Object Name,LinkSpeed | ConvertTo-Json -Compress", &rows) != nil { return }
		for _, row := range rows {
			v := strings.ToLower(strings.TrimSpace(row.LinkSpeed))
			fields := strings.Fields(v)
			if len(fields) == 0 { continue }
			n, err := strconv.ParseFloat(fields[0], 64)
			if err != nil { continue }
			switch {
			case strings.Contains(v, "gbps"): n *= 1000
			case strings.Contains(v, "mbps"):
			case strings.Contains(v, "kbps"): n /= 1000
			}
			linkCache[strings.ToLower(row.Name)] = n
		}
	})
	return linkCache[strings.ToLower(name)]
}

func (c *Collector) collectSMART(inv *Inventory) {
	// Physical-disk SMART mapping to mounted volumes is not one-to-one on
	// Windows (Storage Spaces/RAID). Do not attach guessed health to a volume.
}

func (c *Collector) collectServices(inv *Inventory) {
	var rows []struct {
		Name string `json:"Name"`
		State string `json:"State"`
		StartMode string `json:"StartMode"`
	}
	if err := runPowerShell("Get-CimInstance Win32_Service | Select-Object Name,State,StartMode | ConvertTo-Json -Compress", &rows); err != nil { return }
	for _, row := range rows {
		state := "stopped"
		if strings.EqualFold(row.State, "Running") { state = "running" }
		enabled := strings.EqualFold(row.StartMode, "Auto")
		inv.Services = append(inv.Services, ServiceInfo{Name: row.Name, State: state, Enabled: &enabled, Autoload: strings.ToLower(row.StartMode)})
	}
}

func (c *Collector) collectPackages(inv *Inventory) {
	script := `$paths = @('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
Get-ItemProperty $paths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName,DisplayVersion | ConvertTo-Json -Compress`
	var rows []struct {
		Name string `json:"DisplayName"`
		Version string `json:"DisplayVersion"`
	}
	if err := runPowerShell(script, &rows); err != nil { return }
	for _, row := range rows {
		if row.Name != "" { inv.Packages = append(inv.Packages, PackageInfo{Name: row.Name, Version: row.Version, Ecosystem: "win"}) }
	}
}

func lookupUserName(uid string) string {
	if u, err := user.LookupId(uid); err == nil { return u.Username }
	return uid
}

func listUsers() []UserInfo {
	script := `$admins = @()
try { $admins = @(Get-LocalGroupMember -Group 'Administrators' -ErrorAction Stop | ForEach-Object { $_.SID.Value }) } catch {}
$rows = @()
try {
  foreach ($u in Get-LocalUser -ErrorAction Stop) {
    $sid = $u.SID.Value
    $rows += [pscustomobject]@{
      Name=$u.Name; SID=$sid; Enabled=$u.Enabled; LastLogon=if($u.LastLogon){$u.LastLogon.ToUniversalTime().ToString('o')}else{''}
      IsAdmin=($admins -contains $sid); Description=$u.Description
    }
  }
} catch {}
$rows | ConvertTo-Json -Depth 3 -Compress`
	var rows []struct {
		Name string `json:"Name"`
		SID string `json:"SID"`
		Enabled bool `json:"Enabled"`
		LastLogon string `json:"LastLogon"`
		IsAdmin bool `json:"IsAdmin"`
	}
	if err := runPowerShell(script, &rows); err != nil { return nil }
	out := make([]UserInfo, 0, len(rows))
	for _, row := range rows {
		last := int64(0)
		if t, err := time.Parse(time.RFC3339, row.LastLogon); err == nil { last = t.Unix() }
		out = append(out, UserInfo{
			Username: row.Name, UID: row.SID, Home: "C:\\Users\\" + row.Name,
			Shell: "windows", IsAdmin: row.IsAdmin, LastLogin: last,
		})
	}
	return out
}
