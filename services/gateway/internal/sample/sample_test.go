package sample

import "testing"

func ptr(v float64) *float64 { return &v }

func TestValidateVehicleState(t *testing.T) {
	base := Sample{Tail: "PX4-1", TenantID: "t", Time: "2026-11-03T00:00:00Z", Classification: "UNCLASSIFIED"}
	if err := Validate(base, "", ""); err != nil {
		t.Fatalf("position-only sample rejected: %v", err)
	}
	good := base
	good.BatteryPct = ptr(54)
	good.HeadingDeg = ptr(359.5)
	if err := Validate(good, "", ""); err != nil {
		t.Fatalf("valid state rejected: %v", err)
	}
	for name, bad := range map[string]Sample{
		"battery": {Tail: "PX4-1", TenantID: "t", Time: "x", BatteryPct: ptr(140)},
		"heading": {Tail: "PX4-1", TenantID: "t", Time: "x", HeadingDeg: ptr(360)},
	} {
		if err := Validate(bad, "", ""); err == nil {
			t.Errorf("%s out of range was accepted", name)
		}
	}
}
