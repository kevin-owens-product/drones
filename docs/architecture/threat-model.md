# Threat model

Method: STRIDE against the trust boundaries in the container diagram. Impact is disclosure of another tenant's mission data, an unaudited export, or a tasking change nobody approved. Weapons employment is out of scope because the domain has no such command; the threat is that someone later tries to add one.

## Trust boundaries

| Boundary | Inside | Outside | What crosses |
| --- | --- | --- | --- |
| T1 | Browser session | API | Cookie JWT, JSON. Not clearance. |
| T2 | API process | Postgres `a2e_app` | SQL plus `app.subject`. The password is equivalent to "can set the subject." |
| T3 | API | OPA | Authorization input the API itself built. |
| T4 | Gateway | Aircraft network | MQTT telemetry, RTSP/SRT. Untrusted content. |
| T5 | Core | Edge | Operation log after a disconnect. |
| T6 | Release gate | Receiving org | A file. No live callback. |
| T7 | Cluster | Enterprise IdP | OIDC. Identity only. |
| T8 | Build | Registry | Signed images, SBOMs. |

## STRIDE

| Element | S | T | R | I | D | E |
| --- | --- | --- | --- | --- | --- | --- |
| IdP / session | Stolen CAC or dev password. Mitigation: short-lived tokens, PKCE, brute-force lockout, dev password grant absent from production, test auth refused when `A2E_ENV=production`. | Forged JWT. Mitigation: allow-listed algorithms RS256/ES256, issuer, audience, expiry required. `none` rejected. | Login success and failure appended to the chain, including unknown usernames, without echoing which usernames exist to the client. | Token logged by accident. Mitigation: log redaction of authorization, cookie, password, token. | IdP unavailable. Users cannot log in. No break-glass superuser in the app. | A token claim of `clearance=TOP_SECRET` is ignored. Clearance is a personnel column. |
| API | Subject GUC set to the verified `sub` only. | Request body echoing CUI in a 422. Mitigation: validation errors return field names, not values. | Release and sharing decisions are hash-chained. Chain verifier walks `prev_hash`. | IDOR across tenants. Mitigation: RLS using the subject, not a client tenant list. 404 when a row is invisible. | Rate limit in Redis. Production cannot disable it. Login fails closed if Redis is down. | Role union across tenants. Roles are evaluated for the resource tenant's ancestors, not as a global bag. No platform-wide superuser. |
| Postgres | `a2e_app` password theft impersonates any subject. Mitigation: network policy, password from a secret. `# STUB:` pgaudit is not in this image; the application hash chain is the audit record. Residual: the app role is the PEP's key. | Update of `audit_events`. Mitigation: revoke update/delete, trigger raises, chain head not granted for update. | `pgaudit` plus the application chain. Residual: a holder of the owner role can still rewrite history; that role is not used by the API. | Missing RLS on a new table. Mitigation: new tenant tables called out in review; default privileges grant nothing to the app role. | Connection exhaustion. Pool limits, statement timeouts in Phase 2. | `BYPASSRLS` or superuser given to the app. The migration creates `a2e_app` without those attributes. |
| OPA | — | Policy bundle swapped. Mitigation: policy baked into the signed OPA image; compose mount is dev-only. | Decision logged with reason codes. | OPA input must not contain free-text mission narratives. Identifiers and markings only. | OPA down means 503 and no data. | Default `allow := false`. An empty result is a deny. |
| Sharing agreement | A single admin approves their own draft. Mitigation: `approved_by <> requested_by`, trigger-enforced. | Terms edited in place. Mitigation: terms immutable; revoke and create a new row. Open-ended agreements rejected. Maximum term 365 days. `allow_noforn` defaults false. Descendants excluded unless the row says otherwise. | Approval is an audit event. | Agreement category `audit` is rejected by a check constraint. Cross-tenant write is denied even if the column says `read_write` (`-- STUB` until a later ADR turns it on). | — | Consumer does not gain the provider's admin role. |
| Release gate | Exporter names a recipient in another branch to probe existence. Same error either way. | Snapshot swapped in the database. AES-GCM associated data binds tenant and resource id. | Every allow and deny is chained. | Export of SECRET on a CUI system. System high is enforced in RLS and in the gate, so the row is invisible and not exportable. Unknown caveats fail closed. | — | Format handlers for PDF/CSV/xAPI are not registered, so they cannot skip the gate. |
| Gateway (Phase 2) | Spoofed tail number. Mutual TLS on the vehicle listener is the production control; dev MQTT is inside the compose network. | Malformed telemetry. Schema reject. | Ingest rejects counted in Prometheus. | Telemetry topic from another tenant. Topic prefix is the tenant id checked against the connection's credential. | 10k tails at 5 Hz. Latest-value fan-out, JetStream backpressure, per-tail rate limit. | A sample does not carry a tasking command. The gateway has no mission-write path. |
| Video (Phase 4) | Rogue RTSP publisher. Stream credentials per tenant. | KLV used to move the map camera off the true footprint. Parser treats KLV as untrusted; the map footprint is the parsed polygon, and a failed checksum drops the frame metadata. | Stream on/off audited. | Video object store is not public. HLS tokens scoped to the tenant and the stream. | Link budget. The manager sheds streams instead of blocking the control plane. | No path from a KLV "target" field to a weapons bus. There is no weapons bus. |
| Behaviors (Phase 3) | Unsigned image. Loader requires a signature and a manifest. Promotion below `flight-cleared` cannot be started against a live tail. | Manifest edited after sign. Digest mismatch refuses the load. | Load/start/stop audited. | Behavior container network policy: no default route in the air gap; no cloud metadata address. | Resource limits on the manifest are enforced by the runtime cgroup. | `weapons_interface` must be `forbidden` or the loader rejects the package. |
| Edge | Cloned node. Device identity, Phase 6. | Operation log reordered. Sequence and hash per node. | Conflicts are records, not silent merges. | Edge disk holds a tenant subset, sealed volumes. | 72h store-and-forward bounded by disk quota; oldest telemetry is not dropped silently — the node reports a gap. | Edge cannot approve a plan that core already has in review without the human rule. |
| Supply chain | Typosquat dependency. Lockfiles, pinned images, SBOM, cosign. | Compromised base image. Rebuild from pinned tags; digest pin is a Phase 7 hardening item (`# STUB`). | CI logs the image digest. | Secrets in the image. `.env` is not copied. Dev realm is named `a2e-dev`. | Registry unavailable in the air gap. The bundle script (Phase 6) carries images. | A workflow cannot set `A2E_AUTH_MODE=test` on the production values. Helm `fail` blocks that combination. |

## Abuse cases we explicitly refuse

- A payload kind, task type, or MQTT command for weapons employment or effects release. The enum does not contain one, and the behavior manifest must forbid a weapons interface.
- A global superuser inside the application.
- A clearance, citizenship, or need-to-know claim taken from the token.
- An export path that does not append an audit row.
- A runtime call to a SaaS API, including map tiles, weather, identity, or logging.

## Residual risk

| Risk | Why it remains | Compensating control |
| --- | --- | --- |
| Holder of `a2e_app` can set `app.subject` | RLS has to trust the PEP's connection | Network policy, secret storage, pgaudit, code review of the one `set_config` site |
| Dev Compose is HTTP | Laptop has no PKI | Ingress TLS config is mandatory outside Compose; documented in ADR 0020 |
| OpenSSL in the dev image is not a CMVP-validated module | FIPS validation is a deployment boundary | Algorithms are AES-256-GCM, SHA-256, TLS 1.2+ approved ciphers. Production images must switch on the FIPS provider. Marked `# STUB` |
| Banner over-marks a screen at CUI when the rows are UNCLASSIFIED | System-high floor | Intended. Under-marking is the failure mode we refuse |
| Two agreements, one looser | Any matching agreement can allow a read | Agreements are short, two-person, and audited. Admins must not overlap them carelessly |

Phase 7 turns the residual list into a POA&M. This document is the input, not that package.
