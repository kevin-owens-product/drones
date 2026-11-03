# GNSS spoof gate

`onboard/spoof` is a C17 chi-squared test on the GNSS-minus-VIO residual. Three axes, threshold 11.345 (99 percent, 3 degrees of freedom). Three consecutive failures drop GNSS. Fifty agreeing samples bring it back. The caller keeps the current flight mode.

## Measured on the unit test

| Case | Result |
| --- | --- |
| 40 m step, 2 m sigma | dropped on sample 3 |
| 0.4 m/s drag | detected at 17.1 s |
| 1 hour of matched noise at 10 Hz | 0 false alarms |
| Agreement after a drop | GNSS restored on sample 50 |

The drag and false-alarm checks fail the build if detection takes longer than 30 seconds or the false-alarm count exceeds 1 per hour.
