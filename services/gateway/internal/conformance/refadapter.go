// Package conformance holds a reference adapter for a non-PX4 source and the
// test that holds it to the gateway's ingest contract (docs/design/integration.md).
//
// The contract is telemetry only. An adapter publishes sample.Sample as JSON on
// dmc/v1/<tenant>/<tail>/telemetry (MQTT) or POSTs it to /ingest?topic=<same>.
// There is no path back to the vehicle: adapters do not receive tasking.
package conformance

import (
	"encoding/json"
	"fmt"
	"math"
	"time"

	"a2e.local/gateway/internal/sample"
)

// RoverReading is the native report of a small ground rover with its own
// autopilot (not PX4, not MAVLink): position in decimal degrees, speed in
// km/h, pack voltage, and a fix flag from its GNSS receiver.
type RoverReading struct {
	Unit     string
	Lat, Lon float64
	SpeedKmh float64
	Course   float64 // degrees, may be 360 or negative
	PackV    float64
	CellsS   int
	FixOK    bool
	Driving  bool
	At       time.Time
}

// Topic is the MQTT topic the adapter publishes on.
func Topic(tenant, tail string) string {
	return fmt.Sprintf("dmc/v1/%s/%s/telemetry", tenant, tail)
}

// FromRover maps a rover reading to the ingest contract. It returns the JSON
// payload and the topic. Values the rover does not report stay unset.
func FromRover(tenant string, r RoverReading) ([]byte, string, error) {
	course := math.Mod(math.Mod(r.Course, 360)+360, 360)
	speed := r.SpeedKmh / 3.6
	// Linear LiPo estimate, 3.5 V to 4.2 V per cell, clamped to the contract's range.
	pct := math.Round(math.Max(0, math.Min(100, (r.PackV/float64(r.CellsS)-3.5)/0.7*100))*10) / 10
	mode := "HOLD"
	if r.Driving {
		mode = "MISSION"
	}
	nav := "none"
	if r.FixOK {
		nav = "gnss"
	}
	trusted := r.FixOK
	s := sample.Sample{
		Tail:           r.Unit,
		TenantID:       tenant,
		Time:           r.At.UTC().Format(time.RFC3339Nano),
		Lat:            r.Lat,
		Lon:            r.Lon,
		AltM:           0,
		Classification: "UNCLASSIFIED",
		Caveats:        []string{},
		HeadingDeg:     &course,
		GroundMps:      &speed,
		BatteryPct:     &pct,
		Mode:           mode,
		NavSource:      nav,
		GNSSTrusted:    &trusted,
	}
	b, err := json.Marshal(s)
	return b, Topic(tenant, r.Unit), err
}
