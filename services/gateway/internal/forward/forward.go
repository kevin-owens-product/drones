// Package forward delivers accepted samples to Redis, NATS, and Timescale.
package forward

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nats-io/nats.go"
	"github.com/redis/go-redis/v9"

	"a2e.local/gateway/internal/sample"
)

type Fanout struct {
	redis *redis.Client
	nats  *nats.Conn
	pg    *pgxpool.Pool
	batch chan sample.Sample
}

func Connect(redisURL, natsURL, databaseURL string) *Fanout {
	fan := &Fanout{batch: make(chan sample.Sample, 8192)}
	if redisURL != "" {
		if opts, err := redis.ParseURL(redisURL); err == nil {
			fan.redis = redis.NewClient(opts)
		} else {
			log.Printf("redis url: %v", err)
		}
	}
	if natsURL != "" {
		if conn, err := nats.Connect(natsURL); err != nil {
			log.Printf("nats: %v", err)
		} else {
			fan.nats = conn
		}
	}
	if databaseURL != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		pool, err := pgxpool.New(ctx, databaseURL)
		cancel()
		if err != nil {
			log.Printf("postgres: %v", err)
		} else {
			fan.pg = pool
			go fan.flushLoop()
		}
	}
	return fan
}

func (f *Fanout) Accept(item sample.Sample) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	body, err := json.Marshal(item)
	if err != nil {
		return
	}
	key := item.TenantID + "/" + item.Tail
	if f.redis != nil {
		if err := f.redis.HSet(ctx, "telemetry:latest", key, body).Err(); err != nil {
			log.Printf("redis: %v", err)
		}
	}
	if f.nats != nil {
		subject := "telemetry." + item.TenantID + "." + item.Tail
		if err := f.nats.Publish(subject, body); err != nil {
			log.Printf("nats publish: %v", err)
		}
	}
	if f.pg != nil {
		select {
		case f.batch <- item:
		default:
			log.Printf("timescale batch full")
		}
	}
}

func (f *Fanout) flushLoop() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	var pending []sample.Sample
	flush := func() {
		if len(pending) == 0 || f.pg == nil {
			return
		}
		rows := make([]map[string]any, 0, len(pending))
		for _, item := range pending {
			classification := item.Classification
			if classification == "" {
				classification = "UNCLASSIFIED"
			}
			caveats := item.Caveats
			if caveats == nil {
				caveats = []string{}
			}
			rows = append(rows, map[string]any{
				"time":           item.Time,
				"id":             newID(),
				"tenant_id":      item.TenantID,
				"tail_number":    item.Tail,
				"lat":            item.Lat,
				"lon":            item.Lon,
				"alt_m":          item.AltM,
				"vn":             0,
				"ve":             0,
				"vd":             0,
				"classification": classification,
				"caveats":        caveats,
				"ntk_programs":   []string{},
			})
		}
		pending = nil
		encoded, err := json.Marshal(rows)
		if err != nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, err = f.pg.Exec(ctx, "SELECT ingest_telemetry_batch($1::jsonb)", string(encoded))
		cancel()
		if err != nil {
			log.Printf("timescale: %v", err)
		}
	}
	for {
		select {
		case item := <-f.batch:
			pending = append(pending, item)
			if len(pending) >= 500 {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("00000000-0000-4000-8000-%012d", time.Now().UnixNano()%1e12)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
