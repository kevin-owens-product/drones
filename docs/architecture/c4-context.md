# C4 — system context

```mermaid
C4Context
  title A2E Mission Cloud — system context

  Person(commander, "Mission commander", "Approves plans and tasking changes. Two-person actions where required.")
  Person(planner, "Planner", "Drafts missions, areas, and routes.")
  Person(operator, "Operator", "Executes an approved plan. Accepts aircraft custody.")
  Person(analyst, "Analyst", "ISR sensor custody and debrief. Requests exports.")
  Person(maintainer, "Maintainer", "Airworthiness, software loads, payloads.")
  Person(auditor, "Auditor", "Reads the hash-chained audit log. No mission edit.")
  Person(admin, "Tenant admin", "Memberships and org nodes inside one branch hierarchy.")

  System(a2e, "A2E Mission Cloud", "Plans, monitors, simulates, and debriefs Group 1–3 missions. Sensor custody and navigation only.")

  System_Ext(idp, "Enterprise IdP", "CAC/PIV in production. Keycloak stands in for it in development. The platform trusts the IdP for identity only, not for clearance.")
  System_Ext(aircraft, "Group 1–3 aircraft and radios", "MQTT telemetry and RTSP/SRT video. No weapons interface on this link.")
  System_Ext(fantom, "FANTOM Core", "Government autonomy SDK. Not in this build. Reached only through the AutonomyRuntime port.")
  System_Ext(hq, "Receiving organization", "Gets a file export only after the release gate allows it. No runtime API call to a partner SaaS.")

  Rel(commander, a2e, "Approves", "HTTPS")
  Rel(planner, a2e, "Drafts", "HTTPS")
  Rel(operator, a2e, "Executes", "HTTPS")
  Rel(analyst, a2e, "Debriefs, requests export", "HTTPS")
  Rel(maintainer, a2e, "Updates airworthiness", "HTTPS")
  Rel(auditor, a2e, "Reviews audit", "HTTPS")
  Rel(admin, a2e, "Provisions memberships", "HTTPS")
  Rel(idp, a2e, "OIDC tokens (sub only)", "OIDC")
  Rel(aircraft, a2e, "Telemetry and FMV", "MQTT, RTSP/SRT")
  Rel(a2e, fantom, "Behavior lifecycle", "gRPC, not connected")
  Rel(a2e, hq, "Release-gated file", "sneakernet or accredited transfer")
```

There is no arrow to a map CDN, weather API, identity SaaS, or log SaaS. Forecasts arrive as GRIB2 files on disk. Map tiles are files on disk. Logs stay in the enclave. That is [ADR 0021](adrs/0021-air-gap-and-no-runtime-saas.md).

Coalition users are people inside the same system, admitted by a sharing agreement and a `REL TO` marking. They are not a separate integration.
