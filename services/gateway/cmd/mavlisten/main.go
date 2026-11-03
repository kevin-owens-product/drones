// mavlisten prints decoded MAVLink counts from a UDP port and exits.
package main

import (
	"fmt"
	"os"
	"sync"
	"time"

	"a2e.local/gateway/internal/mavlink"
	"a2e.local/gateway/internal/wire"
)

func main() {
	addr := "0.0.0.0:14550"
	if len(os.Args) > 1 {
		addr = os.Args[1]
	}
	var mu sync.Mutex
	counts := map[string]int{}
	node, err := mavlink.Listen(addr, func(item wire.Sample) {
		mu.Lock()
		counts[item.Name]++
		mu.Unlock()
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	time.Sleep(8 * time.Second)
	node.Close()
	mu.Lock()
	defer mu.Unlock()
	total := 0
	for name, n := range counts {
		fmt.Printf("%s %d\n", name, n)
		total += n
	}
	fmt.Printf("total %d\n", total)
	if counts["HEARTBEAT"] == 0 {
		os.Exit(1)
	}
}
