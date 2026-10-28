// Command gateway accepts MQTT telemetry, keeps the latest value, and can batch it onward.
package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"a2e.local/gateway/internal/pipeline"
	"a2e.local/gateway/internal/sample"
)

func main() {
	pipe := pipeline.New()
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
		if err := pipe.Ingest(item, topicTenant, topicTail); err != nil {
			http.Error(w, "rejected", http.StatusBadRequest)
			return
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
