# Task allocation (CBBA)

`onboard/alloc` is the consensus-based bundle algorithm from Choi, Brunet, and How (2009).

## How it works

Every vehicle keeps its own table: the winning bid and winner it believes in for each task, and a timestamp for the last time it heard (directly or relayed) from each peer. Each round has two phases.

1. **Bundle build.** The vehicle adds tasks one at a time. For each candidate it tries every insertion point in its current path and takes the best marginal gain. The score is time-discounted reward (`reward * 0.98^seconds`), so a task far down a long path is worth less. It only adds a task if its bid beats the bid in its table.
2. **Consensus.** The vehicle reads the tables of the neighbors it heard this round and applies the CBBA update, reset, and leave rules (Table 1 of the paper), using the timestamps to decide whose information is newer.

After consensus, if the vehicle lost a task in its bundle it **releases that task and everything it added after it**. Those later bids were computed on a path that no longer exists. The old greedy auction skipped this step, so an outbid vehicle kept the task in its bundle and two vehicles could fly to the same place.

Path insertion can make a later bid larger than an earlier one, which breaks the diminishing-marginal-gain property CBBA needs to converge. Each bid is capped at the previous bid in the bundle (bid warping, Johnson, Choi, and How, 2011). Before the cap, 13 of 1,000 runs did not converge. After it, all of them did.

The rounds run in one process for testing, but each agent reads only its own state and the messages it received. A message is dropped with a set probability, and the network is an adjacency matrix, so a line of vehicles that can each only hear their neighbors is a normal case.

## Results

From `make -C onboard/alloc test`, six vehicles and twelve tasks in a 500 m square:

| Check | Result |
| --- | --- |
| Random worlds, line network, 20% message loss | 500 |
| Tasks held by two vehicles (full and line runs) | 0 |
| Runs that did not converge | 0 |
| Line results that differ from the fully connected result | 10 of 500, worst at 98.1% of its value |
| Consensus rounds, p50 / p95 | 14 / 22 |
| Re-plan after losing an interior vehicle, mean / worst | 13.1 / 25 rounds |
| Re-plan latency at a 10 Hz message rate | about 1.3 s |

Bid warping keeps convergence but lets message order decide between plans of nearly equal value, which is why a few lossy runs land on a slightly different plan. The test allows up to 5% of seeds to differ and requires at least 90% of the full-network value.

**Limits.** This is a unit check, not a SITL flight. Tasks are points with no time windows. Vehicles do not move during consensus. Loss detection is given (the dead vehicle is marked), where a fielded system would use a heartbeat timeout.

## One search command

`intent_cells` lays a grid over a rectangle. The vehicles bid for the cells. One command covers every vehicle, so two vehicles for one minute is 0.5 operator actions per vehicle per minute.

On a 20 m box with 10 m cells there are 4 cells. At 5 m/s for 2 seconds, two vehicles starting at opposite corners cover at least half the box, and they cover at least as much as one vehicle.
