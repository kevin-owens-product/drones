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

## Fault injector

`fault_apply` produces the four cases. The vehicle flies north at 5 m/s and VIO carries a 0.05 m/s east bias. `make -C onboard/spoof test` measured:

| Fault | Result |
| --- | --- |
| Total loss, GNSS frozen | detected at 1.6 s |
| 40 m step | detected at 0.2 s |
| 0.4 m/s drag | detected at 17.1 s |
| Multipath, 1.5 m noise for 10 min | 0 false alarms |
| Drift while GNSS is dropped | 3.00 m in one minute, RMSE 1.76 m |

The VIO in this run is that bias model. OpenVINS is not feeding PX4 EKF2 yet.
