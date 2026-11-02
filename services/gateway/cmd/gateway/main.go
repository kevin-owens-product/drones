// Command gateway accepts MQTT and HTTP telemetry and forwards the latest value.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"

	"a2e.local/gateway/internal/forward"
	"a2e.local/gateway/internal/pipeline"
	"a2e.local/gateway/internal/sample"
)

func main() {
	pipe := pipeline.New()
	fan := forward.Connect(os.Getenv("A2E_REDIS_URL"), os.Getenv("A2E_NATS_URL"), os.Getenv("A2E_GATEWAY_DATABASE_URL"))
	publish := func(item sample.Sample) {
		fan.Accept(item)
	}
	go subscribeMQTT(pipe, publish)
	if os.Getenv("A2E_GATEWAY_DEMO") == "1" {
		go demo(pipe, publish)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/ingest", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return
		}
		token := os.Getenv("A2E_GATEWAY_TOKEN")
		if token != "" && r.Header.Get("Authorization") != "Bearer "+token {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			http.Error(w, "read", http.StatusBadRequest)
			return
		}
		var item sample.Sample
		if err := json.Unmarshal(body, &item); err != nil {
			http.Error(w, "json", http.StatusBadRequest)
			return
		}
		topicTenant, topicTail := "", ""
		if parts := strings.Split(r.URL.Query().Get("topic"), "/"); len(parts) >= 5 {
			topicTenant, topicTail = parts[2], parts[3]
		}
		ok, err := pipe.Ingest(item, topicTenant, topicTail)
		if err != nil {
			http.Error(w, "rejected", http.StatusBadRequest)
			return
		}
		if ok {
			publish(item)
		}
		w.WriteHeader(http.StatusAccepted)
	})
	mux.HandleFunc("/latest", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"count":` + itoa(pipe.Count()) + `}`))
	})
	addr := env("A2E_GATEWAY_ADDR", ":8088")
	log.Printf("gateway listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}

func subscribeMQTT(pipe *pipeline.Latest, publish func(sample.Sample)) {
	url := os.Getenv("A2E_MQTT_URL")
	if url == "" {
		return
	}
	go func() {
		for {
			opts := mqtt.NewClientOptions().AddBroker(url).SetClientID("a2e-gateway").SetAutoReconnect(true)
			client := mqtt.NewClient(opts)
			token := client.Connect()
			if token.WaitTimeout(10*time.Second) && token.Error() == nil {
				sub := client.Subscribe("a2e/v1/+/+/telemetry", 0, func(_ mqtt.Client, msg mqtt.Message) {
					var item sample.Sample
					if err := json.Unmarshal(msg.Payload(), &item); err != nil {
						return
					}
					parts := strings.Split(msg.Topic(), "/")
					tenant, tail := "", ""
					if len(parts) >= 5 {
						tenant, tail = parts[2], parts[3]
					}
					ok, err := pipe.Ingest(item, tenant, tail)
					if err == nil && ok {
						publish(item)
					}
				})
				sub.Wait()
				log.Printf("mqtt subscribed %s", url)
				return
			}
			log.Printf("mqtt: %v", token.Error())
			time.Sleep(2 * time.Second)
		}
	}()
}

func demo(pipe *pipeline.Latest, publish func(sample.Sample)) {
	const (
		tenant = "11111111-1111-4111-8111-111111111104"
		extra  = 1200
		pass   = 3 * time.Second
	)
	type craft struct {
		tail           string
		classification string
		baseLat        float64
		baseLon        float64
		altM           float64
		phase          float64
		orbitKm        float64 // 0 keeps the original 0.01° ring on N-002 and N-003
	}
	fleet := make([]craft, 0, 2+extra)
	fleet = append(fleet,
		craft{tail: "N-002", classification: "CUI", baseLat: 34.05, baseLon: -106.20, altM: 120},
		craft{tail: "N-003", classification: "UNCLASSIFIED", baseLat: 34.07, baseLon: -106.18, altM: 120},
	)

	// Eight centers inset from the continental box. A gaussian offset around
	// each one reads as a soft cluster instead of a single pile or a grid.
	centers := [8][2]float64{
		{44.6, -119.2},
		{37.4, -119.8},
		{33.8, -111.6},
		{40.8, -104.6},
		{31.2, -97.4},
		{41.6, -90.2},
		{33.2, -83.8},
		{42.6, -75.4},
	}
	const (
		latMin   = 26.0
		latMax   = 48.0
		lonMin   = -124.0
		lonMax   = -68.0
		sigmaLat = 1.15
		sigmaLon = 1.55
	)
	unitNormal := func(r *rand.Rand) float64 {
		u := r.Float64()
		if u < 1e-9 {
			u = 1e-9
		}
		return math.Sqrt(-2*math.Log(u)) * math.Cos(2*math.Pi*r.Float64())
	}
	clamp := func(v, lo, hi float64) float64 {
		if v < lo {
			return lo
		}
		if v > hi {
			return hi
		}
		return v
	}
	for i := 1; i <= extra; i++ {
		r := rand.New(rand.NewSource(int64(i)))
		center := centers[(i-1)%len(centers)]
		fleet = append(fleet, craft{
			tail:           fmt.Sprintf("G-%04d", i),
			classification: "UNCLASSIFIED",
			baseLat:        clamp(center[0]+sigmaLat*unitNormal(r), latMin, latMax),
			baseLon:        clamp(center[1]+sigmaLon*unitNormal(r), lonMin, lonMax),
			altM:           80 + r.Float64()*(400-80),
			phase:          r.Float64() * 2 * math.Pi,
			orbitKm:        2.5 + r.Float64()*1.5,
		})
	}

	log.Printf("demo publishing %d tails, one sample each over %s", len(fleet), pass)
	tick := 0
	for {
		start := time.Now()
		span := time.Duration(len(fleet))
		for i, item := range fleet {
			angle := float64(tick)/8 + item.phase
			dLat := 0.01 * math.Sin(angle)
			dLon := 0.01 * math.Cos(angle)
			if item.orbitKm > 0 {
				const kmPerDeg = 111.32
				dLat = (item.orbitKm / kmPerDeg) * math.Sin(angle)
				cos := math.Cos(item.baseLat * math.Pi / 180)
				if cos < 0.25 {
					cos = 0.25
				}
				dLon = (item.orbitKm / (kmPerDeg * cos)) * math.Cos(angle)
			}
			sampleItem := sample.Sample{
				Tail:           item.tail,
				TenantID:       tenant,
				Time:           time.Now().UTC().Format(time.RFC3339Nano),
				Lat:            item.baseLat + dLat,
				Lon:            item.baseLon + dLon,
				AltM:           item.altM,
				Classification: item.classification,
				Caveats:        []string{},
			}
			if item.tail == "N-002" {
				sampleItem.Caveats = []string{"REL TO USA, GBR"}
			}
			ok, err := pipe.Ingest(sampleItem, sampleItem.TenantID, sampleItem.Tail)
			if err == nil && ok {
				publish(sampleItem)
			}
			slot := start.Add(time.Duration(i+1) * pass / span)
			if wait := time.Until(slot); wait > 0 {
				time.Sleep(wait)
			}
		}
		tick++
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
