package mavlink

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/bluenviron/gomavlib/v3"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/common"

	"a2e.local/gateway/internal/wire"
)

var (
	linkMu  sync.Mutex
	links   []*gomavlib.Node
	stats   = Latency{}
	got     uint64
	missed  uint64
	started = time.Now()
)

// Listen binds a MAVLink 2 UDP server and calls handle for every decoded frame.
func Listen(address string, handle func(wire.Sample)) (*gomavlib.Node, error) {
	address = strings.TrimPrefix(address, "udp://")
	node := &gomavlib.Node{
		Endpoints:   []gomavlib.EndpointConf{gomavlib.EndpointUDPServer{Address: address}},
		Dialect:     common.Dialect,
		OutVersion:  gomavlib.V2,
		OutSystemID: 255,
	}
	if err := node.Initialize(); err != nil {
		return nil, err
	}
	linkMu.Lock()
	links = append(links, node)
	if len(links) == 1 {
		started = time.Now()
	}
	linkMu.Unlock()
	go func() {
		for evt := range node.Events() {
			frame, ok := evt.(*gomavlib.EventFrame)
			if !ok || frame.SystemID() == 255 {
				continue
			}
			t0 := time.Now()
			sample, ok := Decode(frame.SystemID(), frame.Message(), t0)
			linkMu.Lock()
			if ok {
				got++
				stats.Add(time.Since(t0).Microseconds())
			} else {
				missed++
			}
			linkMu.Unlock()
			if ok {
				handle(sample)
			}
		}
	}()
	return node, nil
}

// Send writes a command on the first open MAVLink link.
func Send(system byte, command uint16, param1 float32) error {
	linkMu.Lock()
	defer linkMu.Unlock()
	if len(links) == 0 {
		return fmt.Errorf("no mavlink link")
	}
	return links[0].WriteMessageAll(Command(system, command, param1))
}

// Snapshot is the decode rate and latency since the first link opened.
func Snapshot() (p50Us, p99Us int64, perSec float64, received, dropped uint64) {
	linkMu.Lock()
	defer linkMu.Unlock()
	seconds := time.Since(started).Seconds()
	if seconds <= 0 {
		seconds = 1
	}
	return stats.Percentile(0.50), stats.Percentile(0.99), float64(got) / seconds, got, missed
}
