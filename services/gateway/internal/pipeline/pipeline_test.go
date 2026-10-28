package pipeline

import (
	"fmt"
	"testing"
	"time"

	"a2e.local/gateway/internal/sample"
)

func TestTenThousandVehiclesAtFiveHertz(t *testing.T) {
	pipe := New()
	const vehicles = 10000
	const hz = 5
	start := time.Now()
	var p99 time.Duration
	for tick := 0; tick < hz; tick++ {
		tickStart := time.Now()
		for id := 0; id < vehicles; id++ {
			item := sample.Sample{
				Tail:           fmt.Sprintf("T-%d", id),
				TenantID:       "11111111-1111-4111-8111-111111111104",
				Time:           time.Now().UTC().Format(time.RFC3339Nano),
				Lat:            34 + float64(id%100)/1000,
				Lon:            -106,
				AltM:           100,
				Classification: "UNCLASSIFIED",
			}
			if err := pipe.Ingest(item, item.TenantID, item.Tail); err != nil {
				t.Fatal(err)
			}
		}
		if elapsed := time.Since(tickStart); elapsed > p99 {
			p99 = elapsed
		}
	}
	if pipe.Count() != vehicles {
		t.Fatalf("latest=%d", pipe.Count())
	}
	total := time.Since(start)
	// One second of 5 Hz traffic for 10k tails must be visible well under the 2s UI budget.
	if total > 2*time.Second {
		t.Fatalf("ingest of 10k @ 5 Hz took %s", total)
	}
	t.Logf("10k vehicles x 5 samples in %s, slowest tick %s", total, p99)
}

func TestRejectsCrossTenantTopic(t *testing.T) {
	pipe := New()
	err := pipe.Ingest(sample.Sample{
		Tail: "N-001", TenantID: "a", Time: "2026-10-28T00:00:00Z", Lat: 1, Lon: 1,
		Classification: "UNCLASSIFIED",
	}, "b", "N-001")
	if err == nil {
		t.Fatal("expected tenant mismatch")
	}
}
