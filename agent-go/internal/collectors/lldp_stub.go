//go:build !linux

package collectors

// lldpNeighbors is a no-op on non-Linux platforms (AF_PACKET is Linux-only).
func lldpNeighbors(iface string) []LLDPNeighbor { return nil }
