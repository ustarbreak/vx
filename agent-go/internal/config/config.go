// Package config handles agent configuration: CLI flags, env vars and the
// persisted enrollment file written by `goinfra enroll`. Everything sensitive
// (tenant API token) lives in a 0600 file, never in shell history or argv.
package config

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultServer   = "https://app.infracentra.com"
	DefaultStateDir = "/var/lib/goinfra"
	AgentVersion    = "1.0.0"
)

// Enrollment is what `goinfra enroll` stores on disk. The Token is a tenant
// API credential issued by the platform (Settings → Agents), scoped to one
// organization — so a compromised agent can never read another tenant.
type Enrollment struct {
	Server     string    `json:"server"`
	Token      string    `json:"token"`
	AgentID    string    `json:"agent_id,omitempty"`
	EnrolledAt time.Time `json:"enrolled_at"`
}

// Config merges flags + env + enrollment into runtime settings.
type Config struct {
	ServerURL   string
	Token       string // only used by the enroll subcommand; run loads it from disk
	StateDir    string
	Interval    time.Duration // inventory reporting cadence
	ScanCIDRs   []string      // local discovery CIDRs ("auto" = detect from NICs)
	Policy      bool          // pull scan policy (sweep targets, SNMP creds) from platform
	InsecureTLS bool          // dev only: skip cert verification
	Debug       bool
}

func (c *Config) BindFlags(fs *flag.FlagSet) {
	fs.StringVar(&c.ServerURL, "server", envOr("GOINFRA_SERVER", DefaultServer), "platform base URL")
	fs.StringVar(&c.StateDir, "state-dir", envOr("GOINFRA_STATE_DIR", DefaultStateDir), "agent state directory")
	fs.StringVar(&c.Token, "token", os.Getenv("GOINFRA_TOKEN"), "tenant API token (enroll only)")
	fs.DurationVar(&c.Interval, "interval", envDurOr("GOINFRA_INTERVAL", 5*time.Minute), "inventory report interval")
	fs.Func("scan-cidrs", "comma list of CIDRs to probe locally, or 'auto' (default auto)", func(s string) error {
		c.ScanCIDRs = splitList(s)
		return nil
	})
	if v := os.Getenv("GOINFRA_SCAN_CIDRS"); v != "" && c.ScanCIDRs == nil {
		c.ScanCIDRs = splitList(v)
	}
	fs.BoolVar(&c.Policy, "policy", envBoolOr("GOINFRA_POLICY", true), "pull scan policy from platform")
	fs.BoolVar(&c.InsecureTLS, "insecure", false, "skip TLS verification (dev only)")
	fs.BoolVar(&c.Debug, "debug", envBoolOr("GOINFRA_DEBUG", false), "verbose logging")
}

// Finalize applies defaults after flag parsing.
func (c *Config) Finalize() {
	if len(c.ScanCIDRs) == 0 {
		c.ScanCIDRs = []string{"auto"}
	}
	if c.Interval < 30*time.Second {
		c.Interval = 30 * time.Second
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envDurOr(k string, def time.Duration) time.Duration {
	if v := os.Getenv(k); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

func envBoolOr(k string, def bool) bool {
	if v := os.Getenv(k); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ' ' }) {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// EnrollmentPath returns the on-disk enrollment file path.
func EnrollmentPath(stateDir string) string {
	return filepath.Join(stateDir, "enrollment.json")
}

// SaveEnrollment writes the enrollment atomically with 0600 permissions.
func SaveEnrollment(stateDir string, e Enrollment) error {
	if err := os.MkdirAll(stateDir, 0700); err != nil {
		return err
	}
	tmp := EnrollmentPath(stateDir) + ".tmp"
	b, err := json.MarshalIndent(e, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, EnrollmentPath(stateDir))
}

// LoadEnrollment reads the enrollment file; errors if missing.
func LoadEnrollment(stateDir string) (Enrollment, error) {
	var e Enrollment
	b, err := os.ReadFile(EnrollmentPath(stateDir))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return e, fmt.Errorf("not enrolled: run `sudo goinfra enroll --server <url> --token <api-token>` first")
		}
		return e, err
	}
	err = json.Unmarshal(b, &e)
	return e, err
}
