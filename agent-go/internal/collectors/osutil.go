//go:build !linux

package collectors

import (
	"os/user"
	"strconv"
)

func readDMI(s *SystemInfo)                       {}
func ntpOffsetMs() int64                          { return 0 }
func linkSpeedMbps(name string) float64           { return 0 }
func (c *Collector) collectSMART(i *Inventory)    {}
func (c *Collector) collectServices(i *Inventory) {}
func (c *Collector) collectPackages(i *Inventory) {}
func lookupUserName(uid string) string {
	if u, err := user.LookupId(uid); err == nil {
		return u.Username
	}
	return uid
}
func listUsers() []UserInfo { return nil }

var _ = strconv.Itoa
