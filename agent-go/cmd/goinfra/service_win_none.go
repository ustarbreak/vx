//go:build !windows

package main

func winTaskInstall(exe, stateDir string) error { return nil }
