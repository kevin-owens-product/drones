# A2E Mission Cloud — architecture

Working name **A2E Mission Cloud**. A multi-tenant mission system for Group 1–3 uncrewed aircraft: plan, monitor, simulate, and debrief. Humans approve every mission plan and every change to vehicle tasking.

This build does not employ weapons, release effects, or task a vehicle to do either. Tracking means ISR sensor custody only.

The deployed accreditation target is DoD Impact Level 5 and an air-gapped theater node. **This repository's system high is CUI.** The schema can store higher markings, and the release gate refuses to show or export them until a later accredited build raises the watermark. See [ADR 0015](adrs/0015-release-gate-and-system-high.md).

| Document | What it decides |
| --- | --- |
| [C4 context](c4-context.md) | People and systems outside the platform |
| [C4 containers](c4-containers.md) | Deployable processes and data stores |
| [C4 components](c4-components.md) | Modules inside the API, gateway, sim, and UI |
| [Data model](data-model.md) | Tenancy, markings, fleet, missions, telemetry, video, edge |
| [Threat model](threat-model.md) | STRIDE, trust boundaries, residual risk |
| [Control mapping](control-mapping.md) | NIST SP 800-171 and SP 800-53 Moderate |
| [Sequences](sequences.md) | Login, request authorization, release, edge sync |
| [ADRs](adrs/README.md) | Technology and security decisions |

Phase 0 is design only. Implementation starts at Phase 1 (tenancy, RLS, OIDC, ABAC, audit, release gate, fleet registry). Later phases are specified here so the schema and trust boundaries do not get redrawn under pressure.
