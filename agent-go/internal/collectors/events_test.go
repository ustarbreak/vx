package collectors

import (
	"testing"
)

func TestStableEventIDIsDeterministicAndScoped(t *testing.T) {
	a := stableEventID("journal", "cursor-1")
	if a == "" || a != stableEventID("journal", "cursor-1") {
		t.Fatal("event ID must be deterministic")
	}
	if a == stableEventID("syslog", "cursor-1") {
		t.Fatal("event ID must include source namespace")
	}
}

func TestJournalSeverityMapping(t *testing.T) {
	cases := map[string]string{"0":"critical", "1":"critical", "2":"high", "3":"high", "4":"medium", "5":"low", "6":"info"}
	for input, want := range cases {
		if got := severityFromJournalPriority(input); got != want {
			t.Errorf("priority %s: got %s, want %s", input, got, want)
		}
	}
}
