package mavlink

import "sort"

// Latency keeps decode delays so a test can fail when p50 or p99 regresses.
type Latency struct {
	values []int64
}

func (l *Latency) Add(micros int64) {
	l.values = append(l.values, micros)
}

func (l *Latency) Percentile(p float64) int64 {
	if len(l.values) == 0 {
		return 0
	}
	cp := append([]int64(nil), l.values...)
	sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })
	idx := int(float64(len(cp)-1) * p)
	if idx < 0 {
		idx = 0
	}
	if idx >= len(cp) {
		idx = len(cp) - 1
	}
	return cp[idx]
}

func (l *Latency) Len() int { return len(l.values) }
