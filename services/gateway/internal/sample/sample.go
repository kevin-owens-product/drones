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
	switch item.Classification {
	case "UNCLASSIFIED", "CUI", "":
	default:
		return fmt.Errorf("above system high")
	}
	return nil
}
