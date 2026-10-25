//go:build windows

package main

import (
	"os/exec"
	"strings"
)

// runCmd executes an external command, wrapping failures with their output.
func runCmd(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return &runError{cmd: name + " " + strings.Join(args, " "), out: string(out), err: err}
	}
	return nil
}
