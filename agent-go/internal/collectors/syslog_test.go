package collectors

import "testing"

func TestParseRFC5424Syslog(t *testing.T) {
	ev, ok := parseSyslog("<34>1 2026-11-06T10:00:00Z edge-fw sshd 123 ID47 - invalid login", "192.0.2.5:514")
	if !ok { t.Fatal("expected valid syslog event") }
	if ev.Severity != "critical" || ev.Hostname != "edge-fw" || ev.Provider != "sshd" {
		t.Fatalf("unexpected parsed event: %#v", ev)
	}
	if ev.Raw["facility"] != 4 { t.Fatalf("unexpected facility: %#v", ev.Raw["facility"]) }
}

func TestParseSyslogRejectsEmptyAndOversized(t *testing.T) {
	if _, ok := parseSyslog("", "127.0.0.1:514"); ok { t.Fatal("empty event accepted") }
	if _, ok := parseSyslog(string(make([]byte, 65536)), "127.0.0.1:514"); ok { t.Fatal("oversized event accepted") }
}
