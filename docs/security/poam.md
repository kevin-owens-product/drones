# Plan of action and milestones

Opened from the accepted ADRs and from what this build actually ships. Dates are placeholders for the system owner.

| ID | Weakness | Milestone | Risk |
| --- | --- | --- | --- |
| POA-1 | Dev containers do not load a FIPS-validated module | Production image enables the vendor FIPS provider and records the CMVP certificate | Medium until the accredited image exists |
| POA-2 | Laptop Compose is HTTP | Ingress uses `deploy/nginx/nginx.conf` outside the laptop | Medium in the lab, high if that Compose file is exposed |
| POA-3 | CAC/PIV is not brokered here | Enterprise IdP performs PIV and mints OIDC | High before any real user |
| POA-4 | pgaudit is not in the Alpine-derived database image | Add pgaudit on the production Postgres image | Low while the hash chain is the record of decisions |
| POA-5 | MinIO SSE-S3 key is internal | Attach an external KMS | Medium for objects at rest |
| POA-6 | MQTT allows anonymous clients on the compose network | Per-tenant credentials and mTLS | Medium on a shared lab network |
| POA-7 | Image tags are not digest-pinned | Pin digests in the Helm values after the first promoted build | Low |
| POA-8 | Package line coverage is below 80% | Add route tests for every new handler | Low; the security decisions have unit tests |
| POA-9 | Refresh tokens are not implemented | Re-authentication on expiry, then refresh if the IdP requires it | Low |
| POA-10 | Cross-tenant write is stored and ignored | A follow-on ADR before any write sharing | Low while the function denies it |
