# Mesh relay

`onboard/mesh` finds a path of live vehicles whose consecutive gaps are inside the radio range. A direct miss does not drop the packet when a neighbor can carry it.

The test places radios at 0 m, 9 m, and 18 m with a 10 m range. The ends are out of direct range. The route is two hops, 0-1-2. Killing the middle radio, or cutting the range to 8 m, returns no path.
