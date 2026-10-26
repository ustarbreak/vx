//go:build linux

package collectors

import (
	"encoding/binary"
	"net"
	"time"
)

// readLLDPFrames opens an AF_PACKET listener on iface and decodes LLDP TLVs
// for chassis id + port id of directly connected switches. If the process
// cannot create packet sockets (non-root), it returns nil quickly.
func readLLDPFrames(iface string, dur time.Duration) []LLDPNeighbor {
	pc, err := net.ListenPacket("ether", iface) // requires root/CAP_NET_RAW
	if err != nil {
		return nil
	}
	defer pc.Close()
	pc.SetReadDeadline(time.Now().Add(dur))
	buf := make([]byte, 2048)
	var out []LLDPNeighbor
	seen := map[string]bool{}
	for {
		n, _, err := pc.ReadFrom(buf)
		if err != nil {
			return out
		}
		if nb := decodeLLDP(buf[:n]); nb != nil && !seen[nb.ChassisID] {
			seen[nb.ChassisID] = true
			out = append(out, *nb)
		}
	}
}

// ethertypeLLDP is the IEEE 802.1AB EtherType.
const ethertypeLLDP = 0x88CC

func decodeLLDP(b []byte) *LLDPNeighbor {
	if len(b) < 14 {
		return nil
	}
	et := binary.BigEndian.Uint16(b[12:14])
	if et != ethertypeLLDP {
		return nil
	}
	frame := b[14:]
	nb := &LLDPNeighbor{}
	i := 0
	for i+2 <= len(frame) {
		tlv := binary.BigEndian.Uint16(frame[i:])
		typ := tlv >> 9
		length := int(tlv & 0x1ff)
		i += 2
		if i+length > len(frame) {
			break
		}
		val := frame[i : i+length]
		switch typ {
		case 0: // end of LLDPDU
			i += length
			goto done
		case 4: // Chassis ID
			if len(val) > 1 {
				nb.ChassisID = macOrIP(val)
			}
		case 5: // Port ID
			if len(val) > 1 {
				nb.PortID = macOrIP(val)
			}
		case 7: // TTL - ignore
		}
		i += length
	}
done:
	if nb.ChassisID == "" {
		return nil
	}
	return nb
}

func macOrIP(v []byte) string {
	if len(v) >= 7 && v[0] == 4 {
		return net.HardwareAddr(v[1:7]).String()
	}
	if len(v) >= 5 && v[0] == 1 {
		return net.IP(v[1:5]).String()
	}
	return safeStr(v)
}

func safeStr(v []byte) string {
	out := make([]byte, 0, len(v))
	for _, c := range v {
		if c >= 32 && c < 127 {
			out = append(out, c)
		}
	}
	return string(out)
}
