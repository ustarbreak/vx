//go:build windows

package collectors

import (
	"bytes"
	"encoding/json"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// CollectSystemEvents reads the System, Application and Security Windows
// event channels. Security-channel access depends on the service account;
// inaccessible channels are skipped without suppressing the others.
func CollectSystemEvents(since time.Time, limit int) ([]SecurityEvent, error) {
	if limit <= 0 || limit > 500 {
		limit = 250
	}
	script := `$since = [DateTime]::Parse($args[0]).ToLocalTime()
$logs = @('System','Application','Security')
$rows = @()
foreach ($log in $logs) {
  try {
    $items = Get-WinEvent -FilterHashtable @{LogName=$log; StartTime=$since} -MaxEvents 250 -ErrorAction Stop
    foreach ($e in $items) {
      $rows += [pscustomobject]@{
        RecordId=$e.RecordId; TimeCreated=$e.TimeCreated.ToUniversalTime().ToString('o')
        EventId=$e.Id; Provider=$e.ProviderName; Channel=$e.LogName
        Level=$e.LevelDisplayName; Machine=$e.MachineName; Message=$e.Message
        User=$e.UserId.Value; ProcessId=$e.ProcessId
      }
    }
  } catch { }
}
$rows | Sort-Object TimeCreated | Select-Object -Last 500 | ConvertTo-Json -Depth 4 -Compress`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-Command", script, since.UTC().Format(time.RFC3339))
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	out = bytes.TrimSpace(out)
	if len(out) == 0 || string(out) == "null" {
		return nil, nil
	}
	var rows []map[string]interface{}
	if err := json.Unmarshal(out, &rows); err != nil {
		var one map[string]interface{}
		if err := json.Unmarshal(out, &one); err != nil {
			return nil, err
		}
		rows = []map[string]interface{}{one}
	}
	if len(rows) > limit {
		rows = rows[len(rows)-limit:]
	}
	events := make([]SecurityEvent, 0, len(rows))
	for _, row := range rows {
		message := valueString(row["Message"])
		if message == "" {
			continue
		}
		ts, err := time.Parse(time.RFC3339Nano, valueString(row["TimeCreated"]))
		if err != nil {
			ts = time.Now().UTC()
		}
		level := strings.ToLower(valueString(row["Level"]))
		severity := "info"
		switch level {
		case "critical":
			severity = "critical"
		case "error":
			severity = "high"
		case "warning":
			severity = "medium"
		}
		recordID := valueString(row["RecordId"])
		if recordID == "" {
			recordID = ts.Format(time.RFC3339Nano) + "|" + message
		}
		events = append(events, SecurityEvent{
			EventID: stableEventID("windows-eventlog", valueString(row["Channel"])+"|"+recordID),
			Timestamp: ts.UTC(), Source: "windows-eventlog",
			Channel: valueString(row["Channel"]), Provider: valueString(row["Provider"]),
			Severity: severity, EventCode: valueString(row["EventId"]),
			Hostname: valueString(row["Machine"]), User: valueString(row["User"]),
			Process: valueString(row["ProcessId"]), Message: truncate(message, 8192),
			Raw: map[string]interface{}{"record_id": recordID, "level": level},
		})
	}
	return events, nil
}

func valueString(v interface{}) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatInt(int64(x), 10)
	default:
		return ""
	}
}
