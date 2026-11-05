import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Viewer } from "../shell/types";
import { can, inCustomerView } from "../shell/workspace";
import "./insights.css";

interface LedgerRow {
  key: string;
  sorties: number;
  effective: number;
  aborted: number;
  lost: number;
  loss_rate: number;
  airframe_usd: number;
  packs_usd: number;
  operator_usd: number;
  total_usd: number;
  cost_per_effective_usd: number | null;
}

interface Finding {
  attribute: string;
  value: string;
  sorties: number;
  losses: number;
  rate: number;
  baseline_rate: number;
  ratio: number | null;
  p_value: number;
  flagged: boolean;
  top_cause: string;
  top_cause_share: number;
  in_service_count: number;
  in_service_sample: string[];
}

interface Alert extends Finding {
  raised_day: number;
}

interface SupplyRow {
  unit: string;
  variant: string;
  losses: number;
  per_day: number;
  trend: number | null;
  spares: number;
  days_of_supply: number | null;
  need_expected: number;
  need_high: number;
  short: number;
}

interface Hold {
  attribute: string;
  value: string;
  serials: number;
  by: string;
  at: string;
}

export interface AttritionReport {
  source: string;
  seed: number;
  days: number;
  assumptions: { airframe_usd: Record<string, number>; pack_cycle_usd: number; operator_hour_usd: number };
  total: LedgerRow;
  by_variant: LedgerRow[];
  by_unit: LedgerRow[];
  by_mission: LedgerRow[];
  by_week: LedgerRow[];
  by_week_variant: LedgerRow[];
  autopsy: { window_days: number; first_day: number; last_day: number; tests: number; alerts: Alert[]; top: Finding[] };
  planted: { attribute: string; value: string; start_day: number; multiplier: number; first_flag_day: number | null } | null;
  demand: { window_days: number; horizon_days: number; rows: SupplyRow[]; build_order: Record<string, number> };
  holds?: Hold[];
}

const ATTR: Record<string, string> = {
  esc_lot: "ESC lot",
  motor_lot: "Motor lot",
  factory_lot: "Factory lot",
  firmware: "Firmware",
};

const usd = (n: number | null) => (n === null ? "unbounded" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;

function variantSentence(rows: LedgerRow[], prices: Record<string, number>): string {
  const a = rows.find((r) => r.key === "A");
  const b = rows.find((r) => r.key === "B");
  const pa = prices.A;
  const pb = prices.B;
  if (!a || !b || !pa || !pb || a.cost_per_effective_usd === null || b.cost_per_effective_usd === null) return "";
  const price = (pb - pa) / pa;
  const per = (b.cost_per_effective_usd - a.cost_per_effective_usd) / a.cost_per_effective_usd;
  const cheaper = per < 0;
  return `Variant B costs ${pct(price, 0)} more per airframe and ${pct(Math.abs(per), 0)} ${cheaper ? "less" : "more"} per effective sortie, because it is lost ${pct(1 - b.loss_rate / a.loss_rate, 0)} ${b.loss_rate < a.loss_rate ? "less" : "more"} often.`;
}

function WeekChart({ rows }: { rows: LedgerRow[] }) {
  const weeks = [...new Set(rows.map((r) => r.key.split("/")[0]))];
  const variants = [...new Set(rows.map((r) => r.key.split("/")[1]))].sort();
  const max = Math.max(...rows.map((r) => r.cost_per_effective_usd ?? 0), 1);
  const W = 520;
  const H = 170;
  const pad = { l: 44, r: 8, t: 10, b: 26 };
  const gw = (W - pad.l - pad.r) / weeks.length;
  const bw = Math.min(28, (gw - 16) / variants.length);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, max / 2, max].map((v) => Math.round(v));
  return (
    <svg className="ins-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cost per effective sortie by week and variant">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="ins-grid" />
          <text x={pad.l - 6} y={y(t) + 4} className="ins-axis" textAnchor="end">
            ${t}
          </text>
        </g>
      ))}
      {weeks.map((wk, i) => (
        <g key={wk}>
          {variants.map((v, j) => {
            const row = rows.find((r) => r.key === `${wk}/${v}`);
            const val = row?.cost_per_effective_usd ?? 0;
            const x = pad.l + i * gw + (gw - bw * variants.length) / 2 + j * bw;
            return (
              <rect key={v} x={x + 1} width={bw - 2} y={y(val)} height={y(0) - y(val)} className={`ins-bar ins-bar-${v}`}>
                <title>{`${wk} variant ${v}: ${usd(val)} per effective sortie`}</title>
              </rect>
            );
          })}
          <text x={pad.l + i * gw + gw / 2} y={H - 8} className="ins-axis" textAnchor="middle">
            {wk}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function AttritionPage({ viewer, onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;
  const [report, setReport] = useState<AttritionReport | null>(null);
  const [fault, setFault] = useState("");
  const [showTests, setShowTests] = useState(false);

  function load() {
    void api<AttritionReport>("/v1/attrition")
      .then((r) => {
        onBannerRef.current(r.banner);
        setReport(r.body);
      })
      .catch((error: unknown) => setFault(error instanceof Error ? error.message : "attrition failed"));
  }
  useEffect(load, []);

  async function hold(a: Alert) {
    try {
      await api("/v1/attrition/hold", {
        method: "POST",
        body: JSON.stringify({ attribute: a.attribute, value: a.value, by: viewer.display_name }),
      });
      load();
    } catch (error) {
      setFault(error instanceof Error ? error.message : "hold failed");
    }
  }

  if (!report) {
    return (
      <section className="page">
        {fault ? <p className="fault" role="alert">{fault}</p> : <p className="meta">Loading…</p>}
      </section>
    );
  }

  const t = report.total;
  const holds = report.holds ?? [];
  const held = (a: Finding) => holds.find((h) => h.attribute === a.attribute && h.value === a.value);
  const order = Object.entries(report.demand.build_order).filter(([, n]) => n > 0);
  const first = report.demand.rows[0];
  const customer = inCustomerView(viewer);
  const canHold = can(viewer, "fleet.write");

  return (
    <section className="page ins-page" data-testid="attrition">
      <header className="page-head">
        <div>
          <p className="kicker">Fleet</p>
          <h1 className="page-title">Attrition</h1>
          <p className="lede">
            {customer
              ? "What each effective sortie costs your units, which factory lots are losing your airframes, and when each unit runs short. An effective sortie finished the task it was flown for."
              : "What each effective sortie costs, which factory lots are losing airframes, and what to build next. An effective sortie finished the task it was flown for."}
          </p>
          {customer ? null : (
            <p className="meta">Loss data shared by Customer A. Customers B and C don't share theirs, so they aren't in these numbers.</p>
          )}
        </div>
        <span className="pill pill-warn" title={report.source}>
          SIM
        </span>
      </header>
      <p className="ins-source">
        {report.source}. {report.days} days, seed {report.seed}. Assumed airframe prices{" "}
        {Object.entries(report.assumptions.airframe_usd)
          .map(([k, v]) => `${k} ${usd(v)}`)
          .join(", ")}
        ; {usd(report.assumptions.pack_cycle_usd)} pack wear per sortie; {usd(report.assumptions.operator_hour_usd)} per operator hour.
      </p>
      {fault ? <p className="fault" role="alert">{fault}</p> : null}

      <div className="grid-stats">
        <div className="stat">
          <p className="stat-value">{usd(t.cost_per_effective_usd)}</p>
          <p className="stat-label">Cost per effective sortie</p>
        </div>
        <div className="stat">
          <p className="stat-value">{t.effective.toLocaleString()}</p>
          <p className="stat-label">Effective of {t.sorties.toLocaleString()} sorties</p>
        </div>
        <div className="stat">
          <p className="stat-value">{t.lost}</p>
          <p className="stat-label">Airframes lost ({pct(t.loss_rate)})</p>
        </div>
        <div className="stat">
          <p className="stat-value">{usd(t.airframe_usd)}</p>
          <p className="stat-label">Spent on lost airframes</p>
        </div>
      </div>

      <section className="panel ins-alerts" aria-label="Quality alerts">
        <div className="panel-head">
          <h2>Quality alerts from the loss autopsy</h2>
          <button type="button" className="btn" onClick={() => setShowTests((v) => !v)}>
            {showTests ? "Hide the tests" : "Show the tests"}
          </button>
        </div>
        {report.autopsy.alerts.length === 0 ? <p className="meta">No lot or build stands out from the rest of the fleet.</p> : null}
        {report.autopsy.alerts.map((a) => {
          const h = held(a);
          return (
            <article className="ins-alert" key={`${a.attribute}-${a.value}`}>
              <div>
                <p className="ins-alert-title">
                  {ATTR[a.attribute] ?? a.attribute} <span className="mono">{a.value}</span> is losing airframes at {a.ratio ?? "∞"}x the expected rate
                </p>
                <p className="meta">
                  Raised on day {a.raised_day}: {a.losses} losses in {a.sorties} sorties ({pct(a.rate)} against {pct(a.baseline_rate)} expected for the same units and variants), p = {a.p_value}.{" "}
                  {pct(a.top_cause_share, 0)} logged as {a.top_cause}. {a.in_service_count} airframes from this {a.attribute === "firmware" ? "build" : "lot"} are still in service
                  {a.in_service_sample.length ? `, e.g. ${a.in_service_sample.slice(0, 5).join(", ")}` : ""}.
                </p>
                {h ? (
                  <p className="ins-held" role="status">
                    Held by {h.by}: {h.serials} serials marked not airworthy pending inspection. This is a fleet record; nothing was sent to a vehicle.
                  </p>
                ) : null}
              </div>
              <div className="ins-hold">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={Boolean(h) || !canHold}
                  title={canHold ? undefined : "Holding a lot needs the maintainer, mission commander or admin role."}
                  onClick={() => void hold(a)}
                >
                  {h ? "Held" : `Hold ${a.in_service_count} airframes`}
                </button>
                {!h && !canHold ? <p className="meta">Needs the maintainer, mission commander or admin role.</p> : null}
              </div>
            </article>
          );
        })}
        {showTests ? (
          <div className="table-wrap ins-tests">
            <table>
              <thead>
                <tr>
                  <th>Lot or build</th>
                  <th>Losses / sorties</th>
                  <th>Observed / expected</th>
                  <th>p (one-sided)</th>
                  <th>Flagged today</th>
                </tr>
              </thead>
              <tbody>
                {report.autopsy.top.map((f) => (
                  <tr key={`${f.attribute}-${f.value}`}>
                    <td>
                      {ATTR[f.attribute]} <span className="mono">{f.value}</span>
                    </td>
                    <td className="mono">
                      {f.losses} / {f.sorties}
                    </td>
                    <td className="mono">{f.ratio ?? "∞"}x</td>
                    <td className="mono">{f.p_value}</td>
                    <td>{f.flagged ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="meta ins-note">
              Days {report.autopsy.first_day} to {report.autopsy.last_day}. {report.autopsy.tests} lot and build values tested each day within unit and variant, Bonferroni-corrected at family-wise 0.05,
              with at least 5 losses and 1.5x the expected losses. Association, not cause: a person approves every hold. Detection rates over seeded worlds are in docs/eval/autopsy.md.
            </p>
          </div>
        ) : null}
      </section>

      <div className="ins-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Cost per effective sortie by variant</h2>
          </div>
          <p className="ins-callout">{variantSentence(report.by_variant, report.assumptions.airframe_usd)}</p>
          <WeekChart rows={report.by_week_variant} />
          <p className="ins-legend">
            <span className="ins-key ins-bar-A" /> Variant A <span className="ins-key ins-bar-B" /> Variant B
          </p>
          <div className="table-wrap" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Sorties</th>
                  <th>Lost</th>
                  <th>Total cost</th>
                  <th>Per effective sortie</th>
                </tr>
              </thead>
              <tbody>
                {report.by_variant.map((r) => (
                  <tr key={r.key}>
                    <td>{r.key}</td>
                    <td className="mono">{r.sorties}</td>
                    <td className="mono">
                      {r.lost} ({pct(r.loss_rate)})
                    </td>
                    <td className="mono">{usd(r.total_usd)}</td>
                    <td className="mono">{usd(r.cost_per_effective_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>{customer ? "When each unit runs short" : "Supply and build order"}</h2>
          </div>
          {first?.days_of_supply != null ? (
            <p className="ins-callout">
              {first.unit} runs out of variant {first.variant} spares in {first.days_of_supply} days at {first.per_day} lost a day
              {first.trend && first.trend > 1.2 ? `, ${first.trend}x the rate of the week before` : ""}. {customer ? `Ask Neros to resupply ${first.unit} first.` : `Ship to ${first.unit} first.`}
            </p>
          ) : null}
          <div className="table-wrap" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Variant</th>
                  <th>Lost / day</th>
                  <th>Spares</th>
                  <th>Days of supply</th>
                  <th>{report.demand.horizon_days}-day need (90%)</th>
                </tr>
              </thead>
              <tbody>
                {report.demand.rows.map((r) => (
                  <tr key={`${r.unit}-${r.variant}`} className={r.days_of_supply !== null && r.days_of_supply < 7 ? "ins-short" : ""}>
                    <td>{r.unit}</td>
                    <td>{r.variant}</td>
                    <td className="mono">
                      {r.per_day}
                      {r.trend && r.trend > 1.2 && r.losses >= 8 ? <span className="ins-up"> ▲{r.trend}x</span> : null}
                    </td>
                    <td className="mono">{r.spares}</td>
                    <td className="mono">{r.days_of_supply ?? "–"}</td>
                    <td className="mono">{r.need_high}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {customer ? (
            <p className="ins-callout">
              Neros sees this forecast because you share loss data, and proposes resupply before a unit runs short.{" "}
              <a href="#supply">Request replacements on Supply &amp; support</a>
            </p>
          ) : (
          <p className="ins-callout">
            {order.length
              ? `Build next: ${order.map(([v, n]) => `${n} of variant ${v}`).join(", ")}, to cover every unit's high case for ${report.demand.horizon_days} days.`
              : "Spares on hand cover every unit's high case; no extra build needed."}{" "}
            {order.length ? (
              <a
                href="#company"
                onClick={() => {
                  try {
                    sessionStorage.setItem("a2e-company-tab", "logistics");
                  } catch {
                    /* the link still opens the page */
                  }
                }}
              >
                Plan the replacement kits
              </a>
            ) : null}
          </p>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>By unit and mission</h2>
        </div>
        <div className="table-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th>Sorties</th>
                <th>Effective</th>
                <th>Aborted</th>
                <th>Lost</th>
                <th>Airframes</th>
                <th>Packs</th>
                <th>Operators</th>
                <th>Per effective sortie</th>
              </tr>
            </thead>
            <tbody>
              {[...report.by_unit.map((r) => ({ ...r, key: `Unit ${r.key}` })), ...report.by_mission.map((r) => ({ ...r, key: `Mission: ${r.key}` }))].map((r) => (
                <tr key={r.key}>
                  <td>{r.key}</td>
                  <td className="mono">{r.sorties}</td>
                  <td className="mono">{r.effective}</td>
                  <td className="mono">{r.aborted}</td>
                  <td className="mono">{r.lost}</td>
                  <td className="mono">{usd(r.airframe_usd)}</td>
                  <td className="mono">{usd(r.packs_usd)}</td>
                  <td className="mono">{usd(r.operator_usd)}</td>
                  <td className="mono">{usd(r.cost_per_effective_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
