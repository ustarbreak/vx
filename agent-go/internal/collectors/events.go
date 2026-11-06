package collectors

import (
	"crypto/sha256"
	"encoding/hex"
	"time"
)

// SecurityEvent is the normalized event envelope emitted by local log and
// network-syslog collectors. Raw contains only explicitly selected fields.
type SecurityEvent struct {
	EventID   string                 `json:"event_id"`
	Timestamp time.Time              `json:"timestamp"`
	Source    string                 `json:"source"`
	Channel   string                 `json:"channel,omitempty"`
	Provider  string                 `json:"provider,omitempty"`
	Severity  string                 `json:"severity"`
	EventCode string                 `json:"event_code,omitempty"`
	Hostname  string                 `json:"hostname,omitempty"`
	User      string                 `json:"user,omitempty"`
	Process   string                 `json:"process,omitempty"`
	Message   string                 `json:"message"`
	Raw       map[string]interface{} `json:"raw,omitempty"`
}

// stableEventID produces a deterministic upstream identity so retries and
// overlapping collection windows are idempotent at the ingestion API.
func stableEventID(source, identity string) string {
	sum := sha256.Sum256([]byte(source + "|" + identity))
	return hex.EncodeToString(sum[:])
}

func severityFromJournalPriority(priority string) string {
	switch priority {
	case "0", "1":
		return "critical"
	case "2":
		return "high"
	case "3":
		return "high"
	case "4":
		return "medium"
	case "5":
		return "low"
	default:
		return "info"
	}
}

func severityFromSyslogPriority(priority int) string {
	switch priority {
	case 0, 1:
		return "critical"
	case 2, 3:
		return "high"
	case 4:
		return "medium"
	case 5:
		return "low"
	default:
		return "info"
	}
}
