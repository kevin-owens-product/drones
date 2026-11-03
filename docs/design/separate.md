# Separation

`onboard/separate` looks ahead up to 5 seconds. If two velocity vectors would pass inside the protected radius, each vehicle adds a reciprocal push and then integrates one step.

A head-on pair at 10 m/s closing speed meets at 0 m with no guidance. With a 6 m radius the guided minimum was 20.10 m: they shed the closing speed before they meet. A pair 30 m apart on parallel tracks stays on course. The test fails if the guided minimum drops below 4 m.
