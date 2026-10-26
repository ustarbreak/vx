//go:build linux

package collectors

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// readDMI pulls SMBIOS facts from /sys/class/dmi/id (root needed for serial/uuid).
func readDMI(s *SystemInfo) {
	r := func(p string) string {
		b, err := os.ReadFile(filepath.Join("/sys/class/dmi/id", p))
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(b))
	}
	s.Manufacturer = r("sys_vendor")
	s.ProductName = r("product_name")
	s.SerialNumber = r("product_serial")
	s.UUID = r("product_uuid")
	if s.Manufacturer == "" {
		s.Manufacturer = r("board_vendor")
		s.ProductName = r("board_name")
	}
}

// ntpOffsetMs best-effort chrony tracking line.
func ntpOffsetMs() int64 {
	out, err := exec.Command("chronyc", "tracking").Output()
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "System time") {
			f := strings.Fields(line)
			for i, tok := range f {
				if v, err := strconv.ParseFloat(tok, 64); err == nil && i+1 < len(f) {
					unit := f[i+1]
					switch unit {
					case "milliseconds", "msec":
						return int64(v)
					case "seconds":
						return int64(v * 1000)
					}
				}
			}
		}
	}
	return 0
}

// linkSpeedMbps reads /sys/class/net/<if>/speed (Mb/s), 0 when unknown.
func linkSpeedMbps(name string) float64 {
	b, err := os.ReadFile(filepath.Join("/sys/class/net", name, "speed"))
	if err != nil {
		return 0
	}
	v, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || v <= 0 {
		return 0
	}
	return float64(v)
}

// collectSMART shells out to smartctl when available (never fails the cycle).
func (c *Collector) collectSMART(inv *Inventory) {
	bin, err := exec.LookPath("smartctl")
	if err != nil {
		return
	}
	for i := range inv.Disks {
		dev := inv.Disks[i].Device
		if !strings.HasPrefix(dev, "/dev/") {
			continue
		}
		out, err := exec.Command(bin, "-i", "-A", "-H", "--json", dev).Output()
		if err != nil {
			continue // smartctl exits non-zero on degraded health; JSON still valid
		}
		if sm := parseSmartJSON(out); sm != nil {
			inv.Disks[i].Smart = sm
		}
	}
}

// collectServices enumerates systemd units (best effort via systemctl).
func (c *Collector) collectServices(inv *Inventory) {
	bin, err := exec.LookPath("systemctl")
	if err != nil {
		return
	}
	out, err := exec.Command(bin, "list-units", "--type=service", "--all", "--no-legend", "--plain").Output()
	if err != nil {
		return
	}
	sc := bufio.NewScanner(strings.NewReader(string(out)))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 4 || !strings.HasSuffix(f[0], ".service") {
			continue
		}
		state := f[3] // ACTIVE column: active/inactive/failed
		st := "stopped"
		switch state {
		case "active":
			st = "running"
		case "failed":
			st = "failed"
		}
		name := strings.TrimSuffix(f[0], ".service")
		en := true
		inv.Services = append(inv.Services, ServiceInfo{Name: name, State: st, Enabled: &en})
	}
}

// collectPackages reads dpkg or rpm inventory (light, name+version only).
func (c *Collector) collectPackages(inv *Inventory) {
	if f, err := os.Open("/var/lib/dpkg/status"); err == nil {
		defer f.Close()
		var name, ver string
		sc := bufio.NewScanner(f)
		flush := func() {
			if name != "" && ver != "" {
				inv.Packages = append(inv.Packages, PackageInfo{Name: name, Version: ver, Ecosystem: "deb"})
			}
			name, ver = "", ""
		}
		for sc.Scan() {
			line := sc.Text()
			if line == "" {
				flush()
				continue
			}
			if strings.HasPrefix(line, "Package: ") {
				name = strings.TrimPrefix(line, "Package: ")
			} else if strings.HasPrefix(line, "Version: ") {
				ver = strings.TrimPrefix(line, "Version: ")
			}
		}
		flush()
		return
	}
	if out, err := exec.Command("rpm", "-qa", "--queryformat", "%{NAME}|%{VERSION}\n").Output(); err == nil {
		sc := bufio.NewScanner(strings.NewReader(string(out)))
		for sc.Scan() {
			p := strings.SplitN(sc.Text(), "|", 2)
			if len(p) == 2 {
				inv.Packages = append(inv.Packages, PackageInfo{Name: p[0], Version: p[1], Ecosystem: "rpm"})
			}
		}
	}
}

// lookupUserName resolves uid -> login name from /etc/passwd.
func lookupUserName(uid string) string {
	f, err := os.Open("/etc/passwd")
	if err != nil {
		return uid
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		p := strings.Split(sc.Text(), ":")
		if len(p) >= 3 && p[2] == uid {
			return p[0]
		}
	}
	return uid
}

// listUsers enumerates human + system accounts from /etc/passwd.
func listUsers() []UserInfo {
	f, err := os.Open("/etc/passwd")
	if err != nil {
		return nil
	}
	defer f.Close()
	var out []UserInfo
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		p := strings.Split(sc.Text(), ":")
		if len(p) < 7 {
			continue
		}
		uid, _ := strconv.Atoi(p[2])
		out = append(out, UserInfo{
			Username: p[0], UID: p[2], GID: p[3], Home: p[5], Shell: p[6],
			IsAdmin: uid == 0 || p[6] == "/bin/sudo" || isWheelGroup(p[0]),
		})
	}
	return out
}

func isWheelGroup(name string) bool {
	f, err := os.Open("/etc/group")
	if err != nil {
		return false
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		p := strings.Split(sc.Text(), ":")
		if len(p) >= 4 && (p[0] == "wheel" || p[0] == "sudo") {
			for _, m := range strings.Split(p[3], ",") {
				if m == name {
					return true
				}
			}
		}
	}
	return false
}

var _ = time.Second
