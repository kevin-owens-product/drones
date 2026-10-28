# ADR 0023: Classification, portion marks, and banners

Status: Accepted
Date: 2026-10-28

## Context

Every record, and later every video, track, and file, needs a portion mark. Screens need a banner. The ambiguous part is what an empty screen shows, and whether CUI outranks UNCLASSIFIED for the banner.

## Decision

Ordering used everywhere: `UNCLASSIFIED < CUI < CONFIDENTIAL < SECRET < TOP_SECRET`. CUI is treated as a marking that dominates UNCLASSIFIED for comparison, banners, and release, which is the conservative reading.

Portion mark form: `(U)`, `(CUI)`, `(CUI//NOFORN)`, `(CUI//REL TO USA, GBR)`. A trigger overwrites the stored mark from classification and caveats so a client cannot desynchronize them.

Caveats we understand: `NOFORN`, and `REL TO` followed by ISO 3166-1 alpha-3 codes and/or the token `FVEY` (USA, GBR, CAN, AUS, NZL). Anything else, including `ORCON` until we define it, hides the row. `NOFORN` requires citizenship `USA`. If both `NOFORN` and `REL TO` are present, both have to pass. Citizenship comparison is an exact alpha-3 token, not a substring of `USA`.

Need-to-know: a non-empty program list on the row requires a non-empty intersection with the reader. Empty means no additional program check. Tenant isolation and clearance still apply.

Banner: at least the system high, plus the union of caveats on the rows in the response. A CUI system showing only UNCLASSIFIED rows is still bannered `CUI`. A response that includes any `NOFORN` row is bannered `CUI//NOFORN` even if a neighboring row is unmarked. Over-marking the screen is accepted. Under-marking it is not. The UI paints the system high until the response header arrives, and it refuses to paint the body if the header is missing.

## Consequences

The login screen of a CUI deployment is bannered `CUI`. That matches "highest marking on screen" once the system-high floor is taken as always on screen. Assessors should test the cases in the control-mapping document, not a screenshot.
