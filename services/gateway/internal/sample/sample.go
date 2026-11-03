// Package sample validates vehicle telemetry. It does not accept tasking.
package sample

import "fmt"

type Sample struct {
	Tail           string   `json:"tail_number"`
	TenantID       string   `json:"tenant_id"`
	Time           string   `json:"time"`
	Lat            float64  `json:"lat"`
	Lon            float64  `json:"lon"`
	AltM           float64  `json:"alt_m"`
	Classification string   `json:"classification"`
	Caveats        []string `json:"caveats"`

	// Vehicle state for the operator console. All optional: a sample with
	// only a position is still valid.
	HeadingDeg  *float64 `json:"heading_deg,omitempty"`
	GroundMps   *float64 `json:"ground_mps,omitempty"`
	ClimbMps    *float64 `json:"climb_mps,omitempty"`
	BatteryPct  *float64 `json:"battery_pct,omitempty"`
	Mode        string   `json:"mode,omitempty"`
	Armed       *bool    `json:"armed,omitempty"`
	NavSource   string   `json:"nav_source,omitempty"`
	GNSSTrusted *bool    `json:"gnss_trusted,omitempty"`
}

func Validate(item Sample, topicTenant, topicTail string) error {
	if item.TenantID == "" || item.Tail == "" || item.Time == "" {
		return fmt.Errorf("missing identity")
	}
	if topicTenant != "" && item.TenantID != topicTenant {
		return fmt.Errorf("tenant mismatch")
	}
	if topicTail != "" && item.Tail != topicTail {
		return fmt.Errorf("tail mismatch")
	}
	if item.Lat < -90 || item.Lat > 90 || item.Lon < -180 || item.Lon > 180 {
		return fmt.Errorf("position out of range")
	}
	if item.BatteryPct != nil && (*item.BatteryPct < 0 || *item.BatteryPct > 100) {
		return fmt.Errorf("battery out of range")
	}
	if item.HeadingDeg != nil && (*item.HeadingDeg < 0 || *item.HeadingDeg >= 360) {
		return fmt.Errorf("heading out of range")
	}
	switch item.Classification {
	case "UNCLASSIFIED", "CUI", "":
	default:
		return fmt.Errorf("above system high")
	}
	return nil
}
