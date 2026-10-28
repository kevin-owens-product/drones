// Smoke load against the gateway HTTP ingest. The 10k x 5 Hz proof is the Go test.
import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: 20,
  duration: "15s",
};

export default function () {
  const body = JSON.stringify({
    tail_number: `T-${__VU}`,
    tenant_id: "11111111-1111-4111-8111-111111111104",
    time: new Date().toISOString(),
    lat: 34.05,
    lon: -106.2,
    alt_m: 120,
    classification: "UNCLASSIFIED",
    caveats: [],
  });
  const res = http.post("http://localhost:8088/ingest", body, {
    headers: { "Content-Type": "application/json" },
  });
  check(res, { accepted: (r) => r.status === 202 });
}
