# Optical-flow position hold

`onboard/flowhold` turns downward flow, in radians per second, and a rangefinder reading into a lateral velocity command. The command is the negative of flow times range, which is the velocity that produced the flow.

A flow of 0.2 and −0.1 rad/s at 2 m commands −0.4 and 0.2 m/s. In a closed loop the measured flow is the true lateral speed divided by range, and the vehicle slews halfway toward the command each tenth of a second. After 4 seconds the speed is under 0.05 m/s and the position has moved less than 0.5 m.

This is not yet a PX4 position-hold mode and it does not publish `VISION_POSITION_ESTIMATE`.
