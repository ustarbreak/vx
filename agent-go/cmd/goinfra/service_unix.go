//go:build !windows

package main

import (
	"os/exec"
	"strings"
)

func runCmd(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return &runError{cmd: name + " " + strings.Join(args, " "), out: string(out), err: err}
	}
	return nil
}

type runError struct {
	cmd string
	out string
	err error
}

func (e *runError) Error() string {
	return e.cmd + " failed: " + strings.TrimSpace(e.out) + " (" + e.err.Error() + ")"
}
