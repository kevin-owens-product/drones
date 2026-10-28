// Package pipeline is the ingest core: validate, rate-limit, keep the latest sample.
package pipeline

import (
	"sync"
	"time"

	"a2e.local/gateway/internal/ratelimit"
	"a2e.local/gateway/internal/sample"
)

type Latest struct {
	mu     sync.RWMutex
	items  map[string]sample.Sample
	limit  *ratelimit.Limiter
	seen   int
	drop   int
	notify chan struct{}
}

func New() *Latest {
	return &Latest{
		items:  map[string]sample.Sample{},
		limit:  ratelimit.New(5, 10),
		notify: make(chan struct{}, 1),
	}
}

func (l *Latest) Ingest(item sample.Sample, topicTenant, topicTail string) error {
	if err := sample.Validate(item, topicTenant, topicTail); err != nil {
		l.drop++
		return err
	}
	if !l.limit.Allow(item.TenantID + "/" + item.Tail) {
		l.drop++
		return nil
	}
	l.mu.Lock()
	l.items[item.TenantID+"/"+item.Tail] = item
	l.seen++
	l.mu.Unlock()
	select {
	case l.notify <- struct{}{}:
	default:
	}
	return nil
}

func (l *Latest) Count() int {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return len(l.items)
}

func (l *Latest) Wait(min int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if l.Count() >= min {
			return true
		}
		select {
		case <-l.notify:
		case <-time.After(5 * time.Millisecond):
		}
	}
	return l.Count() >= min
}
