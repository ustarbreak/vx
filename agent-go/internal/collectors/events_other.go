//go:build !linux && !windows

package collectors

import "time"

// CollectSystemEvents is intentionally a no-op on unsupported operating
// systems; inventory and network discovery continue to operate normally.
func CollectSystemEvents(since time.Time, limit int) ([]SecurityEvent, error) {
	return nil, nil
}
