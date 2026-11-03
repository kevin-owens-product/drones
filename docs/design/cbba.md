# Task allocation

`onboard/alloc` is a bundle builder. Each live vehicle bids its reward minus distance and keeps a task only when its bid is the highest. A dead vehicle is marked not alive and the others run the same builder again.

On the three-vehicle, four-task case, the nearest vehicle wins each nearby task. After vehicle 0 is removed, the other two cover all four tasks. One thousand replans averaged 0.03 microseconds. The test fails if a replan takes longer than 1 millisecond or the dropped vehicle still owns a task.

This is one consensus round with static scores, not yet messages on a simulated radio.
