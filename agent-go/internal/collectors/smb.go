package collectors

import (
	"encoding/binary"
	"fmt"
	"net"
	"strings"
	"time"
)

// SMBHostInfo pulls the announced Server Name / OS via an SMB1 Session Setup
// Negotiate exchange (no credentials needed) — same trick smbclient/nmap use.
// Pure stdlib, no external deps. Returns "" values when the target isn't SMB.
func SMBHostInfo(ip string) (serverName, osVersion string, ok bool) {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(ip, "445"), 2*time.Second)
	if err != nil {
		return "", "", false
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(4 * time.Second))

	// SMB1 Negotiate Protocol request (minimal, single dialect NT LM 0.12)
	dialect := append([]byte("NT LM 0.12"), 0)
	hdr := smbHeader(0x72, 0) // SMB_COM_NEGOTIATE
	body := []byte{0x02}      // word count
	body = append(body, 0, 0) // bcc placeholder later
	payload := append([]byte{byte(len(dialect))}, dialect...)
	pkt := append(hdr, body[:1]...)
	pkt = append(pkt, payload...)
	// NetBIOS session header: type 0, length
	tcp := make([]byte, 0, len(pkt)+4)
	tcp = append(tcp, 0, byte(len(pkt)>>8), byte(len(pkt)&0xff))
	tcp = append(tcp, pkt...)
	if _, err := conn.Write(tcp); err != nil {
		return "", "", false
	}
	resp := make([]byte, 4096)
	n, err := conn.Read(resp)
	if err != nil || n < 70 {
		return "", "", false
	}
	// crude parse: look for ASCII runs after the SMB header in the response
	txt := extractASCIIRuns(resp[4:])
	for _, t := range txt {
		l := strings.ToLower(t)
		switch {
		case strings.Contains(l, "windows") || strings.Contains(l, "samba") || strings.Contains(l, "unix"):
			if osVersion == "" {
				osVersion = t
			}
		case strings.Contains(l, "server"):
			serverName = t
		}
	}
	if serverName == "" && len(txt) > 0 {
		serverName = txt[0]
	}
	return serverName, osVersion, serverName != "" || osVersion != ""
}

func smbHeader(cmd byte, pid uint16) []byte {
	h := make([]byte, 32)
	copy(h, "\xffSMB")
	h[4] = cmd
	binary.LittleEndian.PutUint32(h[5:], 0)  // status
	h[9] = 0x18                              // flags unicode
	binary.LittleEndian.PutUint16(h[10:], 1) // high word pid... simplified
	binary.LittleEndian.PutUint16(h[14:], pid)
	return h
}

func extractASCIIRuns(b []byte) []string {
	var out []string
	cur := strings.Builder{}
	for _, c := range b {
		if c >= 32 && c < 127 {
			cur.WriteByte(c)
		} else {
			if cur.Len() >= 4 {
				out = append(out, cur.String())
			}
			cur.Reset()
		}
	}
	if cur.Len() >= 4 {
		out = append(out, cur.String())
	}
	return out
}

var _ = fmt.Sprint
