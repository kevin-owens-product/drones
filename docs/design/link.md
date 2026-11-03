# Link and jammer

`onboard/link` turns distance into a delivery probability. Loss is 20 dB per decade of range. A logistic centered at 60 dB maps that to a success probability. A circular jammer adds 60 dB inside its radius and nothing outside.

Two thousand seeded trials:

| Case | Success |
| --- | --- |
| 50 m, no jammer | 0.987 |
| 50 m, outside a jammer centered elsewhere | 0.987 |
| 5 km | 0.087 |
| 50 m inside the jammer | 0.004 |

The test fails if 50 m drops below 0.90, 5 km rises above 0.15, or the jammer leaves more than 0.20 of packets through.

`docs/eval/link.svg` is written by that test. The pale curve is success against range. The rust curve adds the 60 dB jammer. The dots are the four seeded trial rates above.
