# Task allocation

`onboard/alloc` is a bundle builder. Each live vehicle bids its reward minus distance and keeps a task only when its bid is the highest. A dead vehicle is marked not alive and the others run the same builder again.

On the three-vehicle, four-task case, the nearest vehicle wins each nearby task. After vehicle 0 is removed, the other two cover all four tasks. One thousand replans averaged 0.03 microseconds. The test fails if a replan takes longer than 1 millisecond or the dropped vehicle still owns a task.

This is one consensus round with static scores, not yet messages on a simulated radio.

## One search command

`intent_cells` lays a grid over a rectangle. The vehicles bid for the cells. One command covers every vehicle, so two vehicles for one minute is 0.5 operator actions per vehicle per minute.

On a 20 m box with 10 m cells there are 4 cells. At 5 m/s for 2 seconds, two vehicles starting at opposite corners cover at least half the box, and they cover at least as much as one vehicle.
