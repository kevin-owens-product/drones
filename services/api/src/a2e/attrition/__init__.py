"""Attrition intelligence: what each effective sortie costs, why airframes are
lost, and what the factory should build next.

Three parts share one sortie record:

* ``ledger``  cost per effective sortie by variant, unit, mission and week.
* ``autopsy`` losses joined to birth records, tested by parts lot and build,
  so a bad lot shows up as a quality alert with the serials still in service.
* ``demand``  loss rate per unit turned into days of supply and a build order.

``seed`` makes the synthetic world every number in the demo comes from. It is
simulated: the costs are assumptions and nothing here is a field result.
"""
