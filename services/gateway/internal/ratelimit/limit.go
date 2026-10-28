// Package ratelimit keeps each tail at about 5 Hz with a small burst.
package ratelimit

import "time"

type Limiter struct {
	rate  float64
	burst float64
	now   func() time.Time
	state map[string]bucket
}

type bucket struct {
	tokens float64
	last   time.Time
}

func New(rateHz, burst float64) *Limiter {
	return &Limiter{rate: rateHz, burst: burst, now: time.Now, state: map[string]bucket{}}
}

func (l *Limiter) Allow(key string) bool {
	now := l.now()
	item, ok := l.state[key]
	if !ok {
		l.state[key] = bucket{tokens: l.burst - 1, last: now}
		return true
	}
	elapsed := now.Sub(item.last).Seconds()
	item.tokens += elapsed * l.rate
	if item.tokens > l.burst {
		item.tokens = l.burst
	}
	item.last = now
	if item.tokens < 1 {
		l.state[key] = item
		return false
	}
	item.tokens--
	l.state[key] = item
	return true
}
