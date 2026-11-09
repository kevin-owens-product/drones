# Bid: Army Drone Marketplace CSO, solution brief

Product Exec, Co. submits Drone Mission Cloud to the Department of War Drone Marketplace Commercial Solutions Opening, W58RGZ-26-S-C001, by Method 1 (Innovative Warfighter Solutions), Area of Interest **Supply Chain and Logistics**.

This is a real submission plan, written 9 Nov 2026. It is separate from the in-product Bid desk (`#bid`), which uses simulated solicitations.

## Why this solicitation

| | |
|---|---|
| Solicitation | W58RGZ-26-S-C001, Drone Marketplace Commercial Solutions Opening ([SAM.gov](https://sam.gov/opp/62697af1af6144d2beff760fbbbeee22/view)) |
| Issuer | PMO Uncrewed Aircraft Systems, CPE Aviation (SFAE-AVN-U); contracts by Army Contracting Command, Redstone |
| Current documents | Base CSO R4 (3 Sep 2026) and Attachment 1, IWS procedures R2 (3 Sep 2026), posted 8 Sep 2026 |
| Deadline | None. Open until cancelled (SAM archive date 2031). IWS briefs are accepted on a rolling basis. Calls for Solutions are posted as amendments with their own dates. |
| Fit | AOIs include Supply Chain and Logistics and Software (Command & Control). The Marketplace creates the mixed-vendor fleets this product keeps the record for. |
| Awards | Fixed-price or fixed-price-incentive: FAR Part 12, prototype OT (10 U.S.C. 4022/4023). |
| Evaluation time | The Government expects to evaluate compliant briefs within 90 days. |

Also checked on 9 Nov 2026 and not chosen: the open DoD SBIR/STTR topics (84 topics, all closing 6 Jan 2027; none asks for UAS fleet records or supply traceability; SBIR was reauthorized through 2031 on 13 Apr 2026) and DIU's open solicitations (a USV payload sprint closing 30 Nov 2026 and a classified counter-unmanned call). Watch the CSO for a Call for Solutions on logistics or sustainment: if one is posted, answer it as well, because Calls have funding behind them.

## What the solicitation requires (Attachment 1, Section C.1)

| Requirement | Where it is met | Status |
|---|---|---|
| One PDF, at most 5 pages at 12-point font (or 15 slides) | `build.sh` prints 12-point Times on US Letter and checks page count | 5 body pages with two screenshots: at the limit, so trim before adding text |
| No inserted textboxes, pop-ups or links counted | The brief has no links | Done |
| Title page (not counted): company, title, date, POC name, e-mail, phone, address, CAGE, UEI | Title page | Needs POC title, e-mail, phone, address, date |
| Title page: AOI and Government POC if known | Title page | Done |
| Title page: proposed NAICS and size standard | 541511 Custom Computer Programming ($34.0M), alternate 541512 ($34.0M) | Done: both are on the SAM registration, marked small |
| Executive summary, one page | Section 1 | Done |
| Solution: unique technical aspects, innovation, capability gap, scale, feasibility, team | Section 2 | Needs team sentence |
| Pilot of commercial tech or development; TRL; path to maturity; proprietary aspects | Section 2 | Done (TRL 4, honest) |
| ROM and notional schedule, two-page limit, assumptions annotated | Section 3 | Needs dollar figures |
| Company viability: traction, revenue, pipeline, financial stability | Section 4 | Needs Kevin's facts |
| IP statement (not counted): patents, royalties, data-rights restrictions incl. AI/ML data | IP statement | Done; confirm the license position |
| Proprietary notice on the cover and legend on each restricted sheet | Title page and footer on every page | Done |
| Unclassified, no PII or PHI | Whole brief | Done |
| E-mail to `usarmy.redstone.cpe-avn.mbx.uasmarketplaceiws@army.mil`, AOI in the subject line | `email.md` | Ready to send; an e-mail without the AOI in its subject is not reviewed |

After award (not needed to submit): active SAM registration, WAWF registration for invoicing, small business size representation, responsibility determination, and disclosure of any organizational conflict of interest.

## Documents

| File | What it is |
|---|---|
| `solution-brief.md` | Source of the brief. Placeholders are in `[[double brackets]]`. |
| `figure-record.svg` | The one diagram in the brief. |
| `build.sh`, `print.mjs`, `print.css` | Build the PDF (`./build.sh`). Warns while placeholders remain; fails over the page limit. |
| `email.md` | The submission e-mail. |

Keep the filled-in copy (phone, address, revenue, pipeline) on your own machine. This repository is public, so do not commit those figures here: copy `solution-brief.md` to a private folder, fill it in, and run `./build.sh /path/to/your-copy.md /path/to/out.pdf`.

## Kevin's steps

1. **Settle affiliation questions.** See "Before you send" below.
2. **SAM registration: checked 9 Nov 2026.** Active until 23 Oct 2027, purpose All Awards, reps and certs complete (FAR 52.204-26 answered "does not"), small under every listed NAICS including 541511 and 541512. 513210 (Software Publishers) is not on the registration; the brief uses 541511 instead. Renew before 23 Oct 2027.
3. **Fill the placeholders** in a private copy: your title, e-mail, phone, address, date; one sentence on your background; any other team member; ROM figures; traction, revenue and pipeline; company formation, ownership and runway; OCI statement.
4. **Set the ROM.** A worked starting point: 1.5 FTE for 6 months at about 1,000 hours per FTE and a $185 loaded rate is about $280K, plus about $10K travel, so about $290K firm-fixed-price, paid across five milestones (for example 15/20/20/25/20%). Adjust to what you can staff.
5. **Confirm the license position.** The code is in a public GitHub repository with no license file. The IP statement claims commercial software developed at private expense under a Product Exec, Co. license. Make sure the code is owned by Product Exec, Co. (assign it if it was written personally) and decide whether the repository stays public.
6. **Build and read the PDF.** `./build.sh` on your copy; it must print no placeholder warning and at most 7 pages (title, up to 5 body pages, IP statement).
7. **Send the e-mail** in `email.md` from your company address with the PDF attached.
8. **Afterwards.** Register in WAWF (only needed before an award), watch the CSO on SAM.gov for amendments and Calls for Solutions, and expect a written outcome (Selected, Retained or Not selected) within about 90 days.

## Before you send

- **Affiliation.** The brief must not suggest any affiliation with, data from, or endorsement by any other company. The demo site names other companies' products; evaluators may look at it, so check what it says before sending.
- **Honesty of claims.** Every capability in the brief runs today, but on simulated data. The brief says so and claims TRL 4. Do not add field numbers that do not exist.
- **Export control.** The brief is unclassified and has no weapons content (ADR-0016). It describes software, not controlled technical data, but review it once with ITAR/EAR in mind before sending.
- **Data storage.** The CSO requires Government data to stay in U.S. jurisdiction. The brief proposes installing on Government hosts, which meets this without a commercial cloud. Do not propose the Render-hosted demo for Government data.

## Sources (read 9 Nov 2026)

- Base CSO text and attachments: SAM.gov opportunity 62697af1af6144d2beff760fbbbeee22 (solicitation W58RGZ26SC001), files "DoW Drone Marketplace CSO_R4_3SEP26" and "Attachment_1_Method 1_IWS_DoW_Drone_Marketplace_CSO_R2_3SEP26".
- [DefenseScoop, 13 Mar 2026: Army launches drone marketplace CSO](https://defensescoop.com/2026/03/13/army-uas-marketplace-drone-technology-driscoll-hegseth/)
- [ExecutiveGov: Army UAS Marketplace solicitation](https://www.executivegov.com/articles/army-uas-marketplace-solicitation-cso)
- [SBIR/STTR reauthorized through 2031](https://fundinglandscape.com/answers/sbir-sttr-reauthorization-2026) and [open DoD topics list](https://sbirradar.com/agencies/dow/)
- [DIU open solicitations](https://diu.mil/work-with-us/open-solicitations)
