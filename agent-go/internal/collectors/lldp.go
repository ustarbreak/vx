//go:build linux

package collectors

import (
	"time"
)

// lldpNeighbors listens passively for LLDP frames on an interface for a short
// window (AF_PACKET raw socket). Returns empty when the agent lacks
// CAP_NET_RAW or no switch sends LLDP — never fatal.
func lldpNeighbors(iface string) []LLDPNeighbor {
	done := make(chan []LLDPNeighbor, 1)
	go func() { done <- readLLDPFrames(iface, 2*time.Second) }()
	select {
	case r := <-done:
		return r
	case <-time.After(3 * time.Second):
		return nil
	}
}
