# Control mapping

Baseline intent: NIST SP 800-171 rev. 2 for CUI, and NIST SP 800-53 rev. 5 Moderate as the cloud control set an IL5 assessor will recognize. This is an engineering map, not an SSP. Phase 7 writes the SSP starter and the POA&M. Where this build only prepares the control, the gap is named.

Family coverage that is real in Phase 1 is marked **in place**. Everything scheduled later is marked **planned** so the table is not a claim we have not earned.

## 800-171 (selected requirements that drive design)

| ID | Requirement | Implementation | Evidence | State |
| --- | --- | --- | --- | --- |
| 3.1.1 | Limit system access to authorized users | OIDC, personnel row must exist and not be disabled, RLS | `authn.py`, users table, integration tests | in place |
| 3.1.2 | Limit access to the types of transactions authorized users may execute | Role matrix in `policies/role_matrix/data.json`, enforced in SQL and OPA | Rego tests, `app_action_permitted` | in place |
| 3.1.3 | Control CUI flow | Release gate, sharing agreements, no implicit cross-tenant read | `app_release_allowed`, export tests | in place |
| 3.1.4 | Separation of duties | Two-person sharing approval. Mission approval is two-person in Phase 5 | sharing trigger | in place for sharing |
| 3.1.5 | Least privilege | No superuser in the app. `a2e_app` has no `BYPASSRLS`. Audit insert only through a function | migration grants | in place |
| 3.1.7 | Prevent non-privileged users from executing privileged functions | Admin routes check `user.provision` and `org.write` against the target tenant | RLS and OPA | in place |
| 3.1.12 | Monitor and control remote access | Ingress TLS, session cookies `HttpOnly`/`SameSite`, no token in `localStorage` | nginx config, Helm ingress | partial: Compose HTTP is dev only |
| 3.1.20 | Control CUI on mobile / external | Exports are the only exit, and they are gated | release gate | in place |
| 3.3.1 | Create and retain audit logs | Hash-chained `audit_events`, login failures included | `append_audit`, verifier | in place |
| 3.3.2 | Trace actions to users | `actor_id` bound to the session subject inside the definer function | SQL function | in place |
| 3.4.1 | Baseline configuration | Compose, Helm values, pinned image tags | `docker-compose.yml`, `deploy/helm` | in place |
| 3.4.2 | Security configuration settings | System high, auth mode, rate limit fail closed in production | settings validator, Helm `fail` | in place |
| 3.5.1 | Identify users | Keycloak `sub` or enterprise IdP `sub`, stable UUID in `users` | realm and seed | in place |
| 3.5.2 | Authenticate users | OIDC auth code + PKCE. CAC/PIV is the production authenticator in front of OIDC | ADR 0008 | partial: PIV broker not in this repo |
| 3.5.3 | Use multifactor | CAC/PIV is the intended factor. Dev Keycloak is password, dev realm only | ADR 0008 | gap: dev realm is single factor |
| 3.5.7 | Password policy | Dev realm brute-force protection. Production passwords are not this system's job; the IdP owns them | realm JSON | partial |
| 3.8.1 | Protect CUI media | MinIO SSE-S3, sealed export snapshots, no public buckets | minio init, `crypto.py` | partial: volume encryption is a deploy step |
| 3.8.5 | Control access to media | Export gate | `/v1/exports` | in place |
| 3.12.1 | Vulnerability management | CI SBOM (CycloneDX). Scan and patch process is operational, Phase 7 | `.github/workflows/ci.yml` | partial |
| 3.12.4 | Update malicious code protection / integrity | Image signing with cosign when keys are present | `scripts/sbom.sh`, CI | partial |
| 3.13.1 | Monitor communications | JSON access logs, Prometheus, no payload logging | structlog processors | in place |
| 3.13.8 | Implement crypto in transit | TLS 1.2+ and AES-256-GCM ciphers at ingress | `deploy/nginx/nginx.conf` | partial on laptop HTTP |
| 3.13.11 | FIPS-validated crypto | Approved algorithms only. Validated module is a deployment STUB | ADR 0020 | gap, recorded |
| 3.13.16 | Protect CUI at rest | AES-256-GCM for export snapshots; SSE-S3 for objects; Postgres volume encryption required in deploy | ADR 0020 | partial |
| 3.14.1 | Identify and manage flaws | Tests for RLS, markings, release. Pen-test checklist is Phase 7 | `services/api/tests` | partial |
| 3.14.6 | Deny by default / fail closed | OPA default deny, unknown caveat deny, OPA outage deny, markings above system high invisible | Rego and RLS tests | in place |

## 800-53 Moderate (the controls this design actually implements)

| Control | Name | How | State |
| --- | --- | --- | --- |
| AC-2 | Account management | Provision function, disabled flag, membership validity window | in place |
| AC-3 | Access enforcement | RLS + OPA | in place |
| AC-3(14) | Individual access (attribute) | Clearance, citizenship, NTK, releasability | in place |
| AC-4 | Information flow | Sharing agreements and release gate | in place |
| AC-5 | Separation of duties | Two-person sharing rule | in place |
| AC-6 | Least privilege | Role matrix, no global admin | in place |
| AC-6(9) | Log use of privileged functions | Audit on provision, sharing approve, export | in place |
| AC-17 | Remote access | TLS ingress, OIDC | partial |
| AC-20 | Use of external systems | No runtime SaaS. Exports are controlled | in place |
| AU-2 | Event logging | Auth, authz, export, sharing, custody | in place |
| AU-3 | Content of audit records | Actor, action, resource, decision, reasons, markings, time | in place |
| AU-9 | Protection of audit information | Append-only trigger, revoked update, hash chain | in place |
| AU-9(4) | Access by subset of privileged users | Auditor and admin only, RLS | in place |
| AU-10 | Non-repudiation | Hash chain over canonical body | in place |
| AU-12 | Audit generation | Same path for allow and deny | in place |
| CM-2 | Baseline configuration | Helm + Compose | in place |
| CM-3 | Change control | Promotion gates for behaviors (Phase 3). Image CI | partial |
| CM-6 | Configuration settings | Settings validator refuses unsafe production combinations | in place |
| CM-8 | Component inventory | SBOM per image | partial |
| IA-2 | Identification and authentication | OIDC | in place |
| IA-2(1) | MFA for privileged | CAC/PIV planned at the IdP | gap |
| IA-2(12) | PIV | ADR 0008, not a local PKI | gap |
| IA-5 | Authenticator management | IdP's job in production. Dev secrets in `.env`, not in code | partial |
| IA-8 | External user identification | `REL TO` and citizenship alpha-3 | in place |
| SC-5 | Denial of service protection | Redis rate limit, gateway limits in Phase 2 | partial |
| SC-7 | Boundary protection | Helm network policy, ingress excludes `/metrics` | partial |
| SC-8 | Transmission confidentiality | TLS 1.2+ | partial |
| SC-12 | Key management | `A2E_DATA_KEY` from a secret. Dev all-zero key refused in production. External MinIO KMS is a STUB | partial |
| SC-13 | Cryptographic protection | AES-256-GCM, SHA-256, RS256/ES256 | in place (module validation open) |
| SC-28 | Protection at rest | SSE-S3, sealed snapshots, volume encryption required | partial |
| SI-4 | Monitoring | Prometheus, JSON logs, OTel | in place |
| SI-7 | Integrity | Cosign, audit hash chain, custody hash chain | partial |
| SI-10 | Input validation | Pydantic, SQL checks, telemetry schema in Phase 2 | in place |
| SI-12 | Information management | Portion marks, banner, retention not yet a lifecycle job | partial |

Controls not listed (CP, IR, MA, MP, PE, PL, PS, RA, SA program controls, and the rest of the Moderate catalog) are organizational or are Phase 7 SSP work. They are not claimed here.

## Banner and marking rule the assessor should test

1. A GBR citizen does not receive a `NOFORN` row, even inside the owning team.
2. A user cleared to UNCLASSIFIED does not receive a CUI row.
3. A row marked above the system high is invisible to everyone, including a user whose personnel clearance is higher.
4. An unknown caveat hides the row.
5. A sharing agreement does not cross tenants until it is `active`, unexpired, two-person approved, and the category matches.
6. `allow_noforn = false` hides `NOFORN` rows from the consumer even when the consumer is a US citizen.
7. The `X-A2E-Banner` header is at least the system high, and it includes `NOFORN` if any returned row carries `NOFORN`.
8. Export of a row the caller cannot read is a 404, and an audit row exists either way.
