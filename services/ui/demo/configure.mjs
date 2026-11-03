// Mission configuration planner: pick airframe variant, battery and radio band
// for a mission's range, wind, temperature and expected jamming, and say how
// much energy and link margin is left. Every coefficient below is a textbook
// approximation or an assumption, written out so it can be argued with; none
// is a measured Neros figure. Pure JavaScript, runs in the browser demo.

export const VARIANTS = [
  { id: "A", label: "Variant A (standard radio)", mass_kg: 0.9, link_db: 0, price_usd: 1800 },
  { id: "B", label: "Variant B (hardened radio)", mass_kg: 0.95, link_db: 10, price_usd: 2150 },
];

export const BATTERIES = [
  { id: "6S1300", label: "6S 1300 mAh LiPo", wh: 28.9, mass_kg: 0.21, price_usd: 45 },
  { id: "6S2200", label: "6S 2200 mAh LiPo", wh: 48.8, mass_kg: 0.33, price_usd: 70 },
  { id: "6S4000", label: "6S 4000 mAh Li-ion", wh: 88.8, mass_kg: 0.42, price_usd: 95 },
];

/**
 * Radio bands. `budget_db` is transmit power plus antenna gains minus receiver
 * sensitivity; `loss_1km_db` is free-space loss at 1 km plus a fixed allowance
 * for low-altitude clutter; `jam_db` is how much the assumed threat degrades the
 * band at each jamming level.
 */
export const BANDS = [
  { id: "915", label: "900 MHz", budget_db: 142, loss_1km_db: 112, jam_db: { none: 0, light: 8, heavy: 20 } },
  { id: "2400", label: "2.4 GHz", budget_db: 146, loss_1km_db: 120, jam_db: { none: 0, light: 14, heavy: 32 } },
  { id: "5800", label: "5.8 GHz", budget_db: 148, loss_1km_db: 128, jam_db: { none: 0, light: 14, heavy: 32 } },
];

export const ASSUMPTIONS = {
  hover_w_at_1kg: 95,
  cruise_mps: 16,
  usable_depth: 0.85,
  reserve: 0.2,
  link_margin_db: 10,
  cold_derate_per_c: 0.0075,
};

/** Usable fraction of rated energy at a temperature: full at 20 °C and above, 7.5% less per 10 °C below. */
export function coldFactor(tempC) {
  return Math.max(0.5, Math.min(1, 1 - ASSUMPTIONS.cold_derate_per_c * (20 - tempC)));
}

/** Electrical power in cruise. Hover scales with mass^1.5 (momentum theory); cruise adds a drag term. */
export function cruiseWatts(massKg, airspeed = ASSUMPTIONS.cruise_mps) {
  const hover = ASSUMPTIONS.hover_w_at_1kg * massKg ** 1.5;
  return hover * (0.8 + 0.0012 * airspeed * airspeed);
}

/** Link margin at a distance on a band, with the jamming level and the variant's radio. */
export function linkMargin(band, variant, distanceKm, jamming) {
  const loss = band.loss_1km_db + 20 * Math.log10(Math.max(0.05, distanceKm));
  return band.budget_db + variant.link_db - loss - band.jam_db[jamming];
}

/** Farthest hop, in km, that keeps the required margin. Capped at 30 km: past that, radio horizon and terrain decide, not this model. */
export function hopKm(band, variant, jamming) {
  const db = band.budget_db + variant.link_db - band.loss_1km_db - band.jam_db[jamming] - ASSUMPTIONS.link_margin_db;
  return Math.min(30, 10 ** (db / 20));
}

/**
 * Evaluate one configuration for an out-and-back mission.
 * @param {{ range_km: number, wind_mps: number, temp_c: number, loiter_min: number, jamming: "none"|"light"|"heavy" }} m
 */
export function evaluate(m, variant, battery, band) {
  const mass = variant.mass_kg + battery.mass_kg;
  const v = ASSUMPTIONS.cruise_mps;
  const w = Math.max(0, m.wind_mps);
  const out = v - w;
  const usable = battery.wh * ASSUMPTIONS.usable_depth * coldFactor(m.temp_c);
  if (out <= 1) return { ok: false, reason: "Wind is too strong to make headway", usable_wh: usable };
  // Worst case: headwind one way, tailwind back.
  const seconds = (m.range_km * 1000) / out + (m.range_km * 1000) / (v + w) + m.loiter_min * 60;
  const need = (cruiseWatts(mass) * seconds) / 3600;
  const margin = 1 - need / usable;
  const hop = hopKm(band, variant, m.jamming);
  const relays = hop >= m.range_km ? 0 : Math.ceil(m.range_km / hop) - 1;
  const reasons = [];
  if (margin < 0) reasons.push(`needs ${(need / usable).toFixed(1)}x the pack's usable energy`);
  else if (margin < ASSUMPTIONS.reserve) reasons.push(`energy margin ${Math.round(margin * 100)}% is under the ${ASSUMPTIONS.reserve * 100}% reserve`);
  if (hop < 0.3) reasons.push("link cannot hold 300 m under this jamming");
  return {
    ok: reasons.length === 0,
    reason: reasons.join("; "),
    variant: variant.id,
    battery: battery.id,
    band: band.id,
    mass_kg: Math.round(mass * 100) / 100,
    flight_min: Math.round(seconds / 6) / 10,
    need_wh: Math.round(need * 10) / 10,
    usable_wh: Math.round(usable * 10) / 10,
    energy_margin: Math.round(margin * 1000) / 1000,
    hop_km: Math.round(hop * 100) / 100,
    relays,
    margin_at_range_db: Math.round(linkMargin(band, variant, m.range_km, m.jamming) * 10) / 10,
    price_usd: variant.price_usd + battery.price_usd,
  };
}

/** Every configuration, feasible first: fewest relays, then cheapest, then most energy margin. */
export function plan(m) {
  const all = [];
  for (const v of VARIANTS) for (const b of BATTERIES) for (const r of BANDS) all.push(evaluate(m, v, b, r));
  all.sort((a, b) => Number(b.ok) - Number(a.ok) || (a.relays ?? 99) - (b.relays ?? 99) || (a.price_usd ?? 0) - (b.price_usd ?? 0) || (b.energy_margin ?? 0) - (a.energy_margin ?? 0));
  const best = all[0]?.ok ? all[0] : null;
  const out = { source: "Planning model (assumed coefficients, not measured)", mission: m, assumptions: ASSUMPTIONS, best, options: all };
  return { ...out, summary: explain(out) };
}

/** One sentence for the operator: what to take and why. */
export function explain(result) {
  const b = result.best;
  if (!b) return "No configuration in the catalogue flies this mission with the 20% reserve. Shorten the range, cut the loiter, or wait for the wind to drop.";
  const v = VARIANTS.find((x) => x.id === b.variant);
  const bat = BATTERIES.find((x) => x.id === b.battery);
  const band = BANDS.find((x) => x.id === b.band);
  const relays = b.relays === 0 ? "no relay" : `${b.relays} relay${b.relays > 1 ? "s" : ""} about every ${b.hop_km} km`;
  return `Take ${v.label} with the ${bat.label} pack on ${band.label}: ${Math.round(b.energy_margin * 100)}% energy left after a ${b.flight_min}-minute sortie, and ${relays}.`;
}
