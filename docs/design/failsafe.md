# Link failsafe

`onboard/failsafe` is the per-vehicle link state machine. GNSS rejection does not enter it. The states are continue, loiter, return, and land.

With the link down, continue lasts 2 seconds, loiter 10, return 30, then land. Land stays land. Link restored from loiter or return goes back to continue. Operator return and operator land override the timers. Land overrides return.

While the link is down, `sf_push` keeps telemetry in a 64-slot buffer. `sf_pop` returns it in order when the link is back. A full buffer drops the oldest sample and counts the drop.

`make -C onboard/failsafe test` walks every transition above and the overflow case.
