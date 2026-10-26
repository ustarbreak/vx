//go:build windows

package main

import (
	"os/exec"
	"strings"
)

// winTaskInstall registers an autostart scheduled task running as SYSTEM.
// schtasks ships with every Windows edition, so no extra binaries needed —
// which keeps remote installation a single copy + one command.
func winTaskInstall(exe, stateDir string) error {
	cmd := exec.Command("schtasks", "/create", "/tn", "goinfra-agent",
		"/tr", `"`+exe+`" run --state-dir "`+stateDir+`"`,
		"/sc", "onstart", "/ru", "SYSTEM", "/rl", "HIGHEST", "/f")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return &runError{cmd: "schtasks", out: string(out), err: err}
	}
	// start immediately without waiting for reboot
	if out, err := exec.Command("schtasks", "/run", "/tn", "goinfra-agent").CombinedOutput(); err != nil {
		return &runError{cmd: "schtasks /run", out: string(out), err: err}
	}
	return nil
}

type runError struct {
	cmd, out string
	err      error
}

func (e *runError) Error() string {
	return e.cmd + " failed: " + strings.TrimSpace(e.out) + " (" + e.err.Error() + ")"
}
