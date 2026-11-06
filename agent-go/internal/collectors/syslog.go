package collectors

import (
	"bufio"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
)

// StartSyslogListener starts optional RFC3164/RFC5424 syslog ingestion on UDP
// and TCP at addr. Bind only to trusted interfaces/firewall scopes: syslog has
// no built-in authentication or transport encryption.
func StartSyslogListener(addr string) (<-chan SecurityEvent, error) {
	udp, err := net.ListenPacket("udp", addr)
	if err != nil {
		return nil, fmt.Errorf("syslog UDP listen %s: %w", addr, err)
	}
	tcp, err := net.Listen("tcp", addr)
	if err != nil {
		udp.Close()
		return nil, fmt.Errorf("syslog TCP listen %s: %w", addr, err)
	}
	out := make(chan SecurityEvent, 1024)
	go func() {
		buf := make([]byte, 65535)
		for {
			n, peer, err := udp.ReadFrom(buf)
			if err != nil {
				return
			}
			if ev, ok := parseSyslog(string(buf[:n]), peer.String()); ok {
				out <- ev
			}
		}
	}()
	go func() {
		for {
			conn, err := tcp.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				_ = c.SetReadDeadline(time.Now().Add(5 * time.Minute))
				sc := bufio.NewScanner(c)
				sc.Buffer(make([]byte, 4096), 65535)
				for sc.Scan() {
					if ev, ok := parseSyslog(sc.Text(), c.RemoteAddr().String()); ok {
						out <- ev
					}
				}
			}(conn)
		}
	}()
	return out, nil
}

func parseSyslog(line, remote string) (SecurityEvent, bool) {
	line = strings.TrimSpace(line)
	if line == "" || len(line) > 65535 {
		return SecurityEvent{}, false
	}
	priority := 13 // user.notice default
	message := line
	if strings.HasPrefix(line, "<") {
		end := strings.IndexByte(line, '>')
		if end > 1 && end < 6 {
			if n, err := strconv.Atoi(line[1:end]); err == nil && n >= 0 && n <= 191 {
				priority = n
				message = strings.TrimSpace(line[end+1:])
			}
		}
	}
	facility := priority / 8
	severity := severityFromSyslogPriority(priority % 8)
	host, provider, body := "", "syslog", message
	// RFC5424: VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID STRUCTURED-DATA MSG
	if fields := strings.Fields(message); len(fields) >= 6 && fields[0] == "1" {
		host, provider = fields[2], fields[3]
		body = strings.Join(fields[6:], " ")
	} else if fields := strings.Fields(message); len(fields) >= 4 {
		// Best-effort RFC3164 header parsing. Keep unparsed body intact.
		if strings.Contains(fields[0], ":") {
			host, provider = fields[1], strings.TrimSuffix(fields[2], ":")
			body = strings.Join(fields[3:], " ")
		}
	}
	now := time.Now().UTC()
	identity := remote + "|" + now.Format(time.RFC3339Nano) + "|" + line
	return SecurityEvent{
		EventID: stableEventID("syslog", identity), Timestamp: now,
		Source: "syslog", Channel: "network-syslog", Provider: provider,
		Severity: severity, Hostname: host, Message: truncate(body, 8192),
		Raw: map[string]interface{}{"remote_addr": remote, "facility": facility, "priority": priority},
	}, true
}
