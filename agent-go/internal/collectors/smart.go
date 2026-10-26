//go:build linux

package collectors

import (
	"encoding/json"
	"strconv"
)

// parseSmartJSON interprets `smartctl --json` output into our SMART struct.
func parseSmartJSON(out []byte) *SMART {
	var j struct {
		Device struct {
			Name         string `json:"name"`
			SerialNumber string `json:"serial_number"`
			ModelFamily  string `json:"model_family"`
		} `json:"device"`
		FirmwareVersion string `json:"firmware_version"`
		SmartStatus     struct {
			Pass bool `json:"passed"`
		} `json:"smart_status"`
		Temperature struct {
			Current int `json:"current"`
		} `json:"temperature"`
		PowerOnTimeHours int `json:"power_on_time_hours"`
		VendorAttributes map[string]struct {
			Value    json.Number `json:"value"`
			RawValue struct {
				Value string `json:"string"`
			} `json:"raw_value"`
		} `json:"vendor_attributes"`
	}
	if err := json.Unmarshal(out, &j); err != nil {
		return nil
	}
	sm := &SMART{
		Serial:   j.Device.SerialNumber,
		Model:    j.Device.ModelFamily,
		Firmware: j.FirmwareVersion,
	}
	if j.SmartStatus.Pass {
		sm.OverallStatus = "PASSED"
	} else {
		sm.OverallStatus = "FAILED"
	}
	sm.TempCelsius = j.Temperature.Current
	sm.PowerOnHours = j.PowerOnTimeHours
	for k, v := range j.VendorAttributes {
		switch k {
		case "Wear_Leveling_Count", "Percent_Wear_Leveling_Range", "Media_Wearout_Indicator":
			if n, err := strconv.Atoi(v.Value.String()); err == nil {
				sm.WearLeveling = 100 - n
			}
		case "Reallocated_Sector_Ct":
			if n, err := strconv.Atoi(v.Value.String()); err == nil {
				sm.BadSectors = n
			}
		}
	}
	return sm
}
