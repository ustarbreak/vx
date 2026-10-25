//go:build !linux

package collectors

func (c *Collector) collectIPMI(inv *Inventory) {}
