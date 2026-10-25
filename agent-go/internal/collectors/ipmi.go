//go:build linux

package collectors

import (
	"os"
	"strconv"
	"time"
)

// In-band IPMI over the kernel KCS char device (/dev/ipmi0). The OpenIPMI
// driver accepts a plain IPMI message [netfn<<2|lun, rsAddr, cmd, data...]
// and replies with [netfn+1<<2|lun, rqAddr, cmd, cc, data...]. This gives us
// BMC sensors + SEL + FRU serials without requiring ipmitool on the client.

const (
	ipmiDevice  = "/dev/ipmi0"
	ipmiBmcAddr = 0x20
	netApp      = 0x06 // App netfn (0x06) << 2
	netStorage  = 0x0A // Storage netfn (0x0A) << 2
	netSensor   = 0x30 // Sensor/Event netfn (0x0C) << 2

	cmdGetDevID   = 0x01 // App: Get Device ID
	cmdReserveSDR = 0x22 // Storage: Reserve SDR Repository
	cmdGetSDR     = 0x2D // Storage: Get SDR
	cmdReadFRU    = 0x11 // Storage: Get FRU Inventory Area Info
	cmdFRURd      = 0x10 // Storage: Read FRU Data
	cmdReserveSEL = 0x0F // Storage: Reserve SEL
	cmdGetSelIdx  = 0x40 // Storage: Get SEL Index
	cmdGetSelEnt  = 0x43 // Storage: Get SEL Entry
	cmdSensorRd   = 0x2D // Sensor: Get Sensor Reading
)

func (c *Collector) collectIPMI(inv *Inventory) {
	f, err := os.OpenFile(ipmiDevice, os.O_RDWR, 0)
	if err != nil {
		return // no in-band BMC or insufficient permission — skip silently
	}
	defer f.Close()
	info := &IPMIInfo{Available: true}
	defer func() { inv.IPMI = info }()

	// Device ID -> BMC firmware revision
	resp, err := xcmd(f, netApp, cmdGetDevID, nil)
	if err != nil {
		info.Error = err.Error()
		return
	}
	if len(resp) >= 3 {
		info.BMCVersion = strconv.Itoa(int(resp[1]&0x7f)) + "." + strconv.Itoa(bcdToDec(resp[2]))
	}

	readFRUs(f, info)
	readSensors(f, info)
	readSEL(f, info, 20)
}

// xcmd performs one request/response exchange, returning payload after CC.
func xcmd(f *os.File, netfnLUN byte, cmd byte, data []byte) ([]byte, error) {
	msg := make([]byte, 0, 3+len(data))
	msg = append(msg, netfnLUN, ipmiBmcAddr, cmd)
	msg = append(msg, data...)
	if _, err := f.Write(msg); err != nil {
		return nil, err
	}
	buf := make([]byte, 256)
	if err := f.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
		return nil, err
	}
	n, err := f.Read(buf)
	if err != nil {
		return nil, err
	}
	out := buf[:n]
	// response: [netfn+1<<2|lun, rqaddr, cmd, cc, ...]
	if len(out) < 4 || out[3] != 0 {
		cc := byte(0xFF)
		if len(out) >= 4 {
			cc = out[3]
		}
		return nil, &IPMIError{cc}
	}
	return out[4:], nil
}

type IPMIError struct{ CC byte }

func (e *IPMIError) Error() string {
	return "ipmi completion code 0x" + strconv.FormatInt(int64(e.CC), 16)
}

func bcdToDec(b byte) int { return int(b>>4)*10 + int(b&0x0f) }

// readFRUs walks FRU inventory areas 0..7 and extracts chassis/board/product strings.
func readFRUs(f *os.File, info *IPMIInfo) {
	for area := 0; area < 8; area++ {
		resp, err := xcmd(f, netStorage, cmdReadFRU, []byte{byte(area)})
		if err != nil || len(resp) < 2 {
			continue
		}
		size := int(resp[0]) | int(resp[1])<<8
		if size < 8 || size > 2048 {
			continue
		}
		var data []byte
		for off := 0; off+16 <= size; off += 16 {
			r, err := xcmd(f, netStorage, cmdFRURd, []byte{byte(area), byte(off), byte(off >> 8), 16})
			if err != nil {
				break
			}
			data = append(data, r...)
		}
		if len(data) < 8 || data[0] != 0x01 { // FRU header version 1
			continue
		}
		offset := int(data[1]) * 8
		if offset == 0 || offset+4 > len(data) {
			continue
		}
		strs := fruStrings(data[offset:])
		if len(strs) == 0 {
			continue
		}
		switch area {
		case 0:
			info.FruChassis = pick(strs, 0)
			info.FruProduct = pick(strs, 1)
			info.FruSerial = pick(strs, 2)
		case 1:
			info.FruBoard = pick(strs, 0)
			if info.FruSerial == "" {
				info.FruSerial = pick(strs, 2)
			}
		}
	}
}

// fruStrings decodes length-prefixed ASCII fields of an FRU multirecord area.
func fruStrings(rec []byte) []string {
	if len(rec) < 4 {
		return nil
	}
	p := 3
	var out []string
	for p < len(rec) {
		l := int(rec[p])
		p++
		if l == 0xC1 || p+l > len(rec) { // end-of-keys marker
			break
		}
		if l > 0 {
			out = append(out, sanitize(string(rec[p:p+l])))
		}
		p += l
	}
	return out
}

func pick(s []string, i int) string {
	if i < len(s) {
		return s[i]
	}
	return ""
}

func sanitize(s string) string {
	b := make([]rune, 0, len(s))
	for _, r := range s {
		if r >= 32 && r < 127 {
			b = append(b, r)
		}
	}
	return string(b)
}

// readSensors iterates full SDR records for temperature/fan/voltage sensors.
func readSensors(f *os.File, info *IPMIInfo) {
	reservation := []byte{0, 0}
	if r, err := xcmd(f, netStorage, cmdReserveSDR, nil); err == nil && len(r) >= 2 {
		reservation = r[:2]
	}
	next := []byte{0, 0}
	count := 0
	for count < 96 {
		rec, err := xcmd(f, netStorage, cmdGetSDR,
			append([]byte{reservation[0], reservation[1]}, next[0], next[1], 0, 0xFF))
		if err != nil || len(rec) < 8 {
			break
		}
		// rec: [next record id lo hi][record data...]
		next = rec[0:2]
		body := rec[2:]
		if len(body) < 12 {
			break
		}
		id := body[1]
		sensorType := body[4]
		name := decodeSDRName(body[6 : 6+16])
		if rd, err := xcmd(f, netSensor, cmdSensorRd, []byte{id}); err == nil && name != "" {
			val, unit, status := interpretReading(sensorType, rd)
			info.Sensors = append(info.Sensors, SensorReading{
				Name: name, Type: sensorTypeName(sensorType), Value: val, Unit: unit, Status: status,
			})
			count++
		}
		if next[0] == 0xFF && next[1] == 0xFF {
			break
		}
	}
}

func decodeSDRName(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	if b[0]>>6 == 0 { // 6-bit ASCII packed
		var out []byte
		bitpos := 2
		for i := 1; i < len(b)-1 && bitpos+6 <= len(b)*8-8; i++ {
			v := uint16(b[i])<<8 | uint16(b[i+1])
			shift := uint(16 - (bitpos % 8) - 6)
			ch := byte((v >> shift) & 0x3f)
			out = append(out, sixBit(ch))
			bitpos += 6
		}
		return sanitize(string(out))
	}
	end := len(b)
	if end > 16 {
		end = 16
	}
	return sanitize(string(b[1:end]))
}

func sixBit(c byte) byte {
	const tbl = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~"
	if int(c) < len(tbl) {
		return tbl[c]
	}
	return ' '
}

func sensorTypeName(t byte) string {
	switch t {
	case 0x01:
		return "temperature"
	case 0x04:
		return "fan"
	case 0x02:
		return "voltage"
	case 0x12:
		return "current"
	default:
		return "other"
	}
}

// interpretReading linearly scales raw reading bytes per sensor family.
func interpretReading(stype byte, rd []byte) (float64, string, string) {
	if len(rd) < 2 {
		return 0, "", "na"
	}
	raw := float64(rd[1] & 0x3f)
	status := "ok"
	if rd[1]&0xC0 != 0 {
		status = "warning"
	}
	switch stype {
	case 0x01:
		return raw, "C", status
	case 0x04:
		return raw * 10, "RPM", status
	case 0x02:
		return raw / 10, "V", status
	case 0x12:
		return raw / 10, "A", status
	}
	return raw, "", status
}

// readSEL pulls the most recent N system event log entries.
func readSEL(f *os.File, info *IPMIInfo, n int) {
	reservation := []byte{0, 0}
	if r, err := xcmd(f, netStorage, cmdReserveSEL, nil); err == nil && len(r) >= 2 {
		reservation = r[:2]
	}
	r, err := xcmd(f, netStorage, cmdGetSelIdx, nil)
	if err != nil || len(r) < 2 {
		return
	}
	last := uint16(r[0]) | uint16(r[1])<<8
	got := 0
	id := last
	for id != 0 && id != 0xFFFF && got < n {
		e, err := xcmd(f, netStorage, cmdGetSelEnt,
			[]byte{reservation[0], reservation[1], byte(id), byte(id >> 8), 0, 0xFF})
		if err != nil || len(e) < 12 {
			break
		}
		prev := uint16(e[2]) | uint16(e[3])<<8
		ts := uint32(e[5]) | uint32(e[6])<<8 | uint32(e[7])<<16 | uint32(e[8])<<24
		info.SELRecent = append(info.SELRecent, SELEntry{
			ID: id, Time: int64(ts), Type: "system",
			Sensor: "rec-" + strconv.Itoa(int(e[4])), Event: selDesc(e[11:]),
		})
		id = prev
		got++
	}
}

func selDesc(b []byte) string {
	if len(b) < 3 {
		return ""
	}
	return "evt 0x" + strconv.FormatInt(int64(b[2]), 16)
}
