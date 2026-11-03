# Field reports

A product leader for a fleet that flies far from the factory needs a cheap way to hear from operators. One tap in Operate (`R`, or **Report issue** on the selected vehicle) takes a sentence about what went wrong. It pins the vehicle's tail, firmware build and the last 30 seconds of telemetry the console already holds. The **Field reports** page (`#reports`) groups notes by theme and points at a build when a theme clusters on it.

## How themes and pointers work

`demo/fieldvoice.mjs` sorts notes into themes (video, link, navigation, power, airframe, console) with keyword rules. Rules are easy to read and to argue with, and a note can land in two themes or in none. A theme points at a build when it has at least 4 reports, at least 3 of them on one build, and that build's share of the reports is at least 1.5 times its share of the fleet. That is a reason to look at the build, not proof it is at fault.

In the seeded data, 6 of 6 video reports are on firmware 4.6.0, which is 25% of the fleet. Two of four link reports on 4.5.1 do not raise a pointer.

## Limits

- The 15 seeded reports are made up. Grouping a handful of notes says nothing about real volume or how operators phrase things.
- Reports are kept in the demo server's memory. The API has no table for them yet; persisting them, and linking each to the replay in Debrief, is the next slice.
- Text only. A voice memo would need on-device speech-to-text to stay air-gapped (ADR-0021).
