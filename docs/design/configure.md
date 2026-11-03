# Mission configuration planner

**Configure** (`#configure`) answers a question an operator asks before every sortie: which airframe variant, battery and radio band to take for this mission, and how much margin is left. You enter one-way range, wind, temperature, time on station and expected jamming. It checks all 18 combinations (2 variants × 3 packs × 3 bands), lists them, and recommends one in a sentence. The logic is `demo/configure.mjs`.

## Model

- **Power.** Hover power is 95 W × mass^1.5 (momentum theory), times a drag term at the 16 m/s cruise speed. The sortie flies into the wind one way and with it on the way back, plus the time on station.
- **Energy.** A pack delivers 85% of its rated energy, minus 7.5% for every 10 °C below 20 °C, and must keep a 20% reserve.
- **Link.** Budget minus free-space loss with a clutter allowance, minus an assumed jamming penalty for each band, must leave 10 dB. Variant B's hardened radio adds 10 dB. A hop is capped at 30 km. Relays are spaced at the hop distance.
- **Ranking.** Feasible options come first, then fewest relays, then lowest price.

Two moments the tests pin down:
- At −10 °C on a 3 km mission, the 6S 2200 LiPo drops under the reserve, so the planner moves to the 6S 4000 Li-ion.
- Under heavy jamming at 5 km, variant B needs fewer relays than A, so it is recommended despite the higher price.

## Limits

Every coefficient is a textbook approximation or an assumption, and the page is labelled MODEL. The model leaves out video bandwidth (which is what usually pushes FPV video to 5.8 GHz), terrain masking, pack ageing (the readiness forecast covers that), and how Li-ion sags in the cold compared with LiPo. With real flight logs, the power and derate terms would be fitted per variant. The blackbox and ULog ingest already in the repo is where that data would come from.
