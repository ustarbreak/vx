package snmpx

import (
	"testing"

	"github.com/gosnmp/gosnmp"
)

func TestToStringDecodesIPv4AddressPDU(t *testing.T) {
	p := gosnmp.SnmpPDU{
		Name: "." + oids["ipAdEntAddr"] + ".192.0.2.10",
		Value: []byte{192, 0, 2, 10},
	}
	if got := toString(p); got != "192.0.2.10" {
		t.Fatalf("got %q, want 192.0.2.10", got)
	}
}

func TestToStringKeepsSysDescrBytes(t *testing.T) {
	p := gosnmp.SnmpPDU{Name: "." + oids["sysDescr"], Value: []byte("router OS")}
	if got := toString(p); got != "router OS" {
		t.Fatalf("got %q, want router OS", got)
	}
}

func TestSNMPProtocolMapping(t *testing.T) {
	if authProto("SHA256") != gosnmp.SHA256 {
		t.Fatal("SHA256 mapping is incorrect")
	}
	if privProto("AES256") != gosnmp.AES256 {
		t.Fatal("AES256 mapping is incorrect")
	}
}
