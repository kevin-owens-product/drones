// Calendar ageing of a stored lithium pack: capacity fades with the square root
// of time (SEI growth), faster in heat (Arrhenius) and faster at high charge.
// The stockpile rules (shelf life, storage charge, heat) are rules of thumb for
// exactly this; the model says how much each one costs and what fixing it buys.
//
// Q_loss = k25 · exp(-Ea/R · (1/T - 1/298 K)) · exp(s · (SoC - 0.5)) · sqrt(days)
//
// Conditions change over a pack's life, so loss is carried as an equivalent
// time at reference conditions and stepped forward under each new condition.
// Assumed coefficients in the range of published Li-ion calendar-ageing data
// (high-rate cells: about 5% a year at 25 °C and half charge, several times that hot and full);
// not measured on any Neros pack.

export const AGING = {
  k25_per_sqrt_day: 0.0025, // 2.5% loss after 100 days at 25 °C, 50% (about 5% a year: high-rate drone cells age faster than energy cells)
  ea_j_mol: 50_000,
  soc_slope: 2.0, // about 2.7x faster at full charge than at half
  eol: 0.8, // a pack under 80% of rated capacity no longer flies the planned sortie with reserve
  before_store_c: 25, // factory and transit, assumed
  before_store_soc: 0.5,
  store_swing_c: 5, // a store's average sits this far under the peak it reached
  storage_soc: 0.5,
  cool_store_c: 20,
};

const R = 8.314;
const rate = (tempC, soc) => AGING.k25_per_sqrt_day * Math.exp((-AGING.ea_j_mol / R) * (1 / (tempC + 273.15) - 1 / 298.15)) * Math.exp(AGING.soc_slope * (soc - 0.5));

/** Capacity loss after `days` more at a condition, starting from a loss already carried. */
export function ageFrom(loss, days, tempC, soc) {
  const k = rate(tempC, soc);
  const tEq = (loss / k) ** 2;
  return k * Math.sqrt(tEq + Math.max(0, days));
}

/** Days from now until the pack reaches end of life at a condition (Infinity past 20 years). */
export function daysToEol(loss, tempC, soc) {
  const k = rate(tempC, soc);
  const target = 1 - AGING.eol;
  if (loss >= target) return 0;
  const d = (target / k) ** 2 - (loss / k) ** 2;
  return d > 7300 ? Infinity : Math.round(d);
}

/**
 * One pack's health and what each choice buys.
 * @param {{age_days: number, stored_days: number, soc: number, heat_c: number}} p
 */
export function packHealth(p) {
  const storeC = p.heat_c - AGING.store_swing_c;
  const before = Math.max(0, p.age_days - p.stored_days);
  const loss = ageFrom(ageFrom(0, before, AGING.before_store_c, AGING.before_store_soc), p.stored_days, storeC, p.soc);
  const asIs = daysToEol(loss, storeC, p.soc);
  const charged = daysToEol(loss, storeC, Math.min(p.soc, AGING.storage_soc));
  const cool = daysToEol(loss, Math.min(storeC, AGING.cool_store_c), Math.min(p.soc, AGING.storage_soc));
  const fin = (d) => (Number.isFinite(d) ? d : null);
  return {
    health_pct: Math.round((1 - loss) * 1000) / 10,
    store_c: storeC,
    eol_days: fin(asIs),
    eol_days_storage_charge: fin(charged),
    eol_days_cool: fin(cool),
  };
}

/** Projected health over the next `days` for the three choices, for a chart. */
export function projection(p, days = 720, step = 30) {
  const storeC = p.heat_c - AGING.store_swing_c;
  const before = Math.max(0, p.age_days - p.stored_days);
  const loss = ageFrom(ageFrom(0, before, AGING.before_store_c, AGING.before_store_soc), p.stored_days, storeC, p.soc);
  const out = [];
  for (let d = 0; d <= days; d += step) {
    out.push({
      d,
      as_is: Math.round((1 - ageFrom(loss, d, storeC, p.soc)) * 1000) / 10,
      storage: Math.round((1 - ageFrom(loss, d, storeC, Math.min(p.soc, AGING.storage_soc))) * 1000) / 10,
      cool: Math.round((1 - ageFrom(loss, d, Math.min(storeC, AGING.cool_store_c), Math.min(p.soc, AGING.storage_soc))) * 1000) / 10,
    });
  }
  return out;
}
