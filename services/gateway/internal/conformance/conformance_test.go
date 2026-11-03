package conformance

import (
	"encoding/json"
	"sort"
	"strings"
	"testing"
	"time"

	"a2e.local/gateway/internal/pipeline"
	"a2e.local/gateway/internal/sample"
)

const tenant = "11111111-1111-4111-8111-111111111104"

// ingest does what cmd/gateway does with an MQTT message: decode the JSON,
// take tenant and tail from the topic, and hand both to the pipeline.
func ingest(pipe *pipeline.Latest, topic string, payload []byte) (bool, error) {
	var item sample.Sample
	if err := json.Unmarshal(payload, &item); err != nil {
		return false, err
	}
	parts := strings.Split(topic, "/")
	t, tail := "", ""
	if len(parts) >= 5 {
		t, tail = parts[2], parts[3]
	}
	return pipe.Ingest(item, t, tail)
}

func reading() RoverReading {
	return RoverReading{Unit: "UGV-7", Lat: 35.74, Lon: -120.76, SpeedKmh: 7.2, Course: -90, PackV: 15.4, CellsS: 4, FixOK: true, Driving: true, At: time.Unix(1793700000, 0)}
}

func TestRoverAdapterPassesIngest(t *testing.T) {
	pipe := pipeline.New()
	payload, topic, err := FromRover(tenant, reading())
	if err != nil {
		t.Fatal(err)
	}
	if topic != "a2e/v1/"+tenant+"/UGV-7/telemetry" {
		t.Fatalf("topic %q", topic)
	}
	ok, err := ingest(pipe, topic, payload)
	if err != nil || !ok {
		t.Fatalf("rejected: ok=%v err=%v", ok, err)
	}
	if pipe.Count() != 1 {
		t.Fatalf("latest=%d", pipe.Count())
	}
	var got sample.Sample
	_ = json.Unmarshal(payload, &got)
	if *got.HeadingDeg != 270 || *got.GroundMps != 2 || *got.BatteryPct != 50 || got.NavSource != "gnss" {
		t.Fatalf("mapping: heading=%v speed=%v battery=%v nav=%s", *got.HeadingDeg, *got.GroundMps, *got.BatteryPct, got.NavSource)
	}
}

// The wire keys are the stable interface. Renaming one breaks every adapter,
// so this list changes only with a new topic version (a2e/v2/...).
func TestContractKeysAreStable(t *testing.T) {
	payload, _, _ := FromRover(tenant, reading())
	var m map[string]any
	if err := json.Unmarshal(payload, &m); err != nil {
		t.Fatal(err)
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	want := "battery_pct,caveats,classification,gnss_trusted,ground_mps,heading_deg,lat,lon,mode,nav_source,tail_number,tenant_id,time"
	// alt_m is 0 for a ground vehicle and still present; omitempty is not set on it.
	want = "alt_m," + want
	if got := strings.Join(keys, ","); got != want {
		t.Fatalf("keys changed:\n got %s\nwant %s", got, want)
	}
}

func TestIngestRejectsNonConformingAdapters(t *testing.T) {
	cases := map[string]func(r *RoverReading) (string, func([]byte) []byte){
		"tail differs from topic": func(r *RoverReading) (string, func([]byte) []byte) {
			return Topic(tenant, "UGV-8"), nil
		},
		"tenant differs from topic": func(r *RoverReading) (string, func([]byte) []byte) {
			return Topic("other", r.Unit), nil
		},
		"position out of range": func(r *RoverReading) (string, func([]byte) []byte) {
			r.Lat = 91
			return "", nil
		},
		"above system high": func(r *RoverReading) (string, func([]byte) []byte) {
			return "", func(b []byte) []byte {
				return []byte(strings.Replace(string(b), `"UNCLASSIFIED"`, `"SECRET"`, 1))
			}
		},
	}
	for name, mutate := range cases {
		pipe := pipeline.New()
		r := reading()
		topic, edit := mutate(&r)
		payload, own, err := FromRover(tenant, r)
		if err != nil {
			t.Fatal(err)
		}
		if topic == "" {
			topic = own
		}
		if edit != nil {
			payload = edit(payload)
		}
		if ok, err := ingest(pipe, topic, payload); err == nil || ok {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestAdapterClampsBattery(t *testing.T) {
	r := reading()
	r.PackV = 17.6 // above full charge for 4S
	payload, topic, _ := FromRover(tenant, r)
	if ok, err := ingest(pipeline.New(), topic, payload); err != nil || !ok {
		t.Fatalf("overcharged pack rejected: %v", err)
	}
}
