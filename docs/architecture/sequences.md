# Sequences

## Request authorization

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant K as IdP
  participant P as Postgres
  participant O as OPA

  B->>A: Cookie or Bearer
  A->>K: JWKS (cached), verify iss/aud/exp/sig
  Note over A: Token sub is the only claim used
  A->>P: set_config(app.subject) local to this transaction
  A->>P: load principal, app_roles_for, app_action_permitted
  A->>O: input built server-side
  alt SQL and OPA both allow
    A->>P: business query (RLS still applies)
    A->>P: append audit when the action is a decision
    A-->>B: body + X-A2E-Banner
  else either denies, or OPA is down
    A->>P: append deny audit
    A-->>B: 403 or 503, no row content
  end
```

A missing `app.subject` yields no rows. A failed OPA call yields no rows. The banner floor is the system high (`CUI` in this build) so a screen is never painted below the accreditation level. Caveats are added from the rows actually returned.

## Release

```mermaid
sequenceDiagram
  participant U as Exporter
  participant A as API
  participant P as Postgres
  participant O as OPA

  U->>A: POST /v1/exports
  A->>P: read resource via RLS
  alt not visible
    A->>P: audit deny (not_found)
    A-->>U: 404
  else visible
    A->>P: app_release_allowed(recipient, markings)
    A->>O: release.export with recipient attributes
    alt both allow and format is json
      A->>A: AES-256-GCM seal the snapshot
      A->>P: store ciphertext receipt + hash-chain audit
      A-->>U: plaintext JSON over TLS, banner header
    else
      A->>P: audit deny
      A-->>U: 403, reason codes, no payload
    end
  end
```

The recipient is a principal the exporter is allowed to name (same hierarchy, or the other side of an active sharing agreement). Unknown recipient and unauthorized recipient return the same denial. PDF, CSV, and xAPI are specified for Phase 5; this build refuses them after the authorization check so the attempt is still audited.

## Edge reconnect (Phase 6)

```mermaid
sequenceDiagram
  participant E as Edge
  participant C as Core

  Note over E: Up to 72h with no route to core
  E->>E: Append telemetry, audit, local plan edits
  E->>C: Ship the operation log, in order, with the last ack
  alt telemetry or audit
    C->>C: Append. Duplicates are idempotent on event id.
  else mission plan touched on both sides
    C->>C: Freeze the plan. Commander resolves.
  else custody chain forked
    C->>C: Reject the fork until an officer reconciles.
  end
```
