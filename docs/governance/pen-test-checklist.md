# Penetration-test checklist

Use this against a lab deployment, not a production enclave, and not against anyone else's system. Record evidence in the POA&M.

| Check | Expected |
| --- | --- |
| Token `alg: none` | 401 |
| Clearance claim in the token | Ignored. A CUI personnel row still cannot read a row above the system high |
| Request for another team's tail id | 404, and the row is absent under RLS |
| GBR user reads `NOFORN` | Row absent |
| Unknown caveat `ORCON` | Row absent |
| Sharing agreement approved by its requester | 403 `two_person_required` |
| Behavior manifest with `weapons_interface: enabled` | 400 |
| Behavior calls `mission.approve` | Rejected |
| Direct `UPDATE` on `audit_events` as `a2e_app` | Permission denied |
| Export of PDF/CSV/xAPI without `release.export` | 403, no file |
| OPA stopped | 503, no rows |
| MQTT topic tenant differs from the payload | Gateway rejects the sample |
| Metrics on the public ingress | 404 via the nginx snippet |
| `/docs` when `A2E_ENV=production` | Not mounted |

Out of scope: weapons employment, because the domain has no such command.
