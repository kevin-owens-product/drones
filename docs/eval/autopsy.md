# Loss autopsy: detection on seeded worlds

Simulated. Each world is four units, 760 airframes and 28 days of sorties from
`a2e.attrition.seed`. One ESC lot (about 1 in 6 airframes) is made worse from day 14;
the autopsy is not told which. A trailing 14-day window is tested every day from day 13,
within unit and variant, Bonferroni-corrected at family-wise alpha 0.05 across the 18
lot and build values, with at least 5 losses and 1.5x the expected losses. An alert
stays raised once a day's test clears.

| Bad lot loss multiplier | Worlds | Bad lot alerted | Median days from going bad to alert | Alerts on other values | Same seeds, nothing planted: worlds with any alert |
| --- | --- | --- | --- | --- | --- |
| 2x | 100 | 17 (17%) | 11 | 0 | 3 (3%) |
| 3x | 100 | 85 (85%) | 9 | 1 | 3 (3%) |
| 4x | 100 | 98 (98%) | 8 | 2 | 3 (3%) |

The last column is the false-alarm rate per 15-day scan of a fleet with no bad lot.
At 2x the trailing window often holds too few losses to clear the correction; that
is the price of keeping false alarms rare. A real fleet would stratify by unit and
mission before an alert grounds anything, and a person approves every hold.
