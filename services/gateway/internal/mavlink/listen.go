package mavlink

import (
	"strings"
	"time"

	"github.com/bluenviron/gomavlib/v3"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/common"

	"a2e.local/gateway/internal/wire"
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
	go func() {
		for evt := range node.Events() {
			frame, ok := evt.(*gomavlib.EventFrame)
			if !ok || frame.SystemID() == 255 {
				continue
			}
			sample, ok := Decode(frame.SystemID(), frame.Message(), time.Now())
			if !ok {
				continue
			}
			handle(sample)
		}
	}()
	return node, nil
}
