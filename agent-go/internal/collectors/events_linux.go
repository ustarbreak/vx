//go:build linux

package collectors

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// CollectSystemEvents reads recent high-signal journal entries. It does not
// read arbitrary files or shell-expand user input. The caller persists the
// last successful poll time; deterministic cursor IDs suppress overlap.
func CollectSystemEvents(since time.Time, limit int) ([]SecurityEvent, error) {
	bin, err := exec.LookPath("journalctl")
	if err != nil {
		return nil, nil // journald is optional on minimal Linux distributions
	}
	if limit <= 0 || limit > 500 {
		limit = 250
	}
	cmd := exec.Command(bin, "--since", "@"+strconv.FormatInt(since.Unix(), 10),
		"--output=json", "--no-pager", "-n", strconv.Itoa(limit))
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	hostname, _ := exec.Command("hostname").Output()
	host := strings.TrimSpace(string(hostname))
	sc := bufio.NewScanner(bytes.NewReader(out))
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	events := make([]SecurityEvent, 0, limit)
	for sc.Scan() {
		line := sc.Bytes()
		var row map[string]interface{}
		if json.Unmarshal(line, &row) != nil {
			continue
		}
		message := stringValue(row["MESSAGE"])
		if message == "" {
			continue
		}
		ts := time.Now().UTC()
		if micros := int64Value(row["__REALTIME_TIMESTAMP"]); micros > 0 {
			ts = time.UnixMicro(micros).UTC()
		}
		cursor := stringValue(row["__CURSOR"])
		if cursor == "" {
			cursor = ts.Format(time.RFC3339Nano) + "|" + message
		}
		provider := firstNonEmpty(stringValue(row["SYSLOG_IDENTIFIER"]),
			stringValue(row["_SYSTEMD_UNIT"]), stringValue(row["_COMM"]))
		pid := stringValue(row["_PID"])
		user := stringValue(row["_UID"])
		event := SecurityEvent{
			EventID: stableEventID("journald", cursor), Timestamp: ts,
			Source: "host-journal", Channel: "systemd-journal",
			Provider: provider, Severity: severityFromJournalPriority(stringValue(row["PRIORITY"])),
			Hostname: firstNonEmpty(stringValue(row["_HOSTNAME"]), host),
			User: user, Process: firstNonEmpty(stringValue(row["_COMM"]), pid),
			Message: truncate(message, 8192),
			Raw: map[string]interface{}{
				"unit": stringValue(row["_SYSTEMD_UNIT"]),
				"pid": pid, "uid": user,
				"facility": stringValue(row["SYSLOG_FACILITY"]),
			},
		}
		events = append(events, event)
	}
	return events, sc.Err()
}

func stringValue(v interface{}) string {
	switch x := v.(type) {
	case string:
		return x
	case json.Number:
		return x.String()
	case float64:
		return strconv.FormatInt(int64(x), 10)
	default:
		return ""
	}
}

func int64Value(v interface{}) int64 {
	n, _ := strconv.ParseInt(stringValue(v), 10, 64)
	return n
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
