package mavlink

import (
	"testing"
	"time"

	"github.com/bluenviron/gomavlib/v3"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/common"

	"a2e.local/gateway/internal/wire"
)

func TestProtobufRoundTripKeepsSignedPosition(t *testing.T) {
	in := wire.Sample{
		SystemID: 1, Name: "GLOBAL_POSITION_INT", ReceivedUnixNs: 1_700_000_000_000_000_000,
		LatE7: 377749000, LonE7: -1224194000, AltMM: 120000,
		Roll: 0.1, Pitch: -0.2, Yaw: 1.5,
		VxCms: -30, BatteryRemainingPct: 73, VoltageMV: 16800,
	}
	out, err := wire.Unmarshal(wire.Marshal(in))
	if err != nil {
		t.Fatal(err)
	}
	if out != in {
		t.Fatalf("round trip %+v", out)
	}
}

func TestPercentiles(t *testing.T) {
	var lat Latency
	for i := 1; i <= 100; i++ {
		lat.Add(int64(i))
	}
	if got := lat.Percentile(0.50); got != 51 && got != 50 {
		t.Fatalf("p50 %d", got)
	}
	p99 := lat.Percentile(0.99)
	if p99 < 99 {
		t.Fatalf("p99 %d", p99)
	}
}

func TestDecodeOverUDP(t *testing.T) {
	server := &gomavlib.Node{
		Endpoints:        []gomavlib.EndpointConf{gomavlib.EndpointUDPServer{Address: "127.0.0.1:17660"}},
		Dialect:          common.Dialect,
		OutVersion:       gomavlib.V2,
		OutSystemID:      255,
		HeartbeatDisable: true,
	}
	if err := server.Initialize(); err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	client := &gomavlib.Node{
		Endpoints:        []gomavlib.EndpointConf{gomavlib.EndpointUDPClient{Address: "127.0.0.1:17660"}},
		Dialect:          common.Dialect,
		OutVersion:       gomavlib.V2,
		OutSystemID:      1,
		HeartbeatDisable: true,
	}
	if err := client.Initialize(); err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	time.Sleep(50 * time.Millisecond)

	sent := time.Now()
	err := client.WriteMessageAll(&common.MessageGlobalPositionInt{
		Lat: 377749000, Lon: -1224194000, Alt: 120000, Vx: 10, Vy: -5, Vz: 1, Hdg: 9000,
	})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	for {
		select {
		case evt := <-server.Events():
			frame, ok := evt.(*gomavlib.EventFrame)
			if !ok {
				continue
			}
			sample, ok := Decode(frame.SystemID(), frame.Message(), time.Now())
			if !ok || sample.Name != "GLOBAL_POSITION_INT" {
				continue
			}
			if sample.LatE7 != 377749000 || sample.LonE7 != -1224194000 || sample.AltMM != 120000 {
				t.Fatalf("position %+v", sample)
			}
			delay := time.Since(sent)
			if delay > 100*time.Millisecond {
				t.Fatalf("localhost p99-style delay %s", delay)
			}
			back, err := wire.Unmarshal(wire.Marshal(sample))
			if err != nil || back.LonE7 != sample.LonE7 {
				t.Fatalf("wire %v %+v", err, back)
			}
			return
		case <-deadline:
			t.Fatal("no global position")
		}
	}
}

func TestSustainedDecodeRate(t *testing.T) {
	msg := &common.MessageHeartbeat{CustomMode: 4, BaseMode: 81, SystemStatus: 4}
	start := time.Now()
	const n = 200000
	var lat Latency
	for i := 0; i < n; i++ {
		t0 := time.Now()
		sample, ok := Decode(1, msg, t0)
		lat.Add(time.Since(t0).Microseconds())
		if !ok || sample.Name != "HEARTBEAT" || sample.CustomMode != 4 {
			t.Fatal(sample)
		}
	}
	seconds := time.Since(start).Seconds()
	perSec := float64(n) / seconds
	t.Logf("decode_per_sec %.0f p50_us %d p99_us %d", perSec, lat.Percentile(0.50), lat.Percentile(0.99))
	if perSec < 200000 {
		t.Fatalf("decode rate %.0f under 200000/s", perSec)
	}
	if lat.Percentile(0.99) > 100 {
		t.Fatalf("decode p99 %d us", lat.Percentile(0.99))
	}
}
