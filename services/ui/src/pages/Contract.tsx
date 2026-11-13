import { useState } from "react";
import type { Viewer } from "../shell/types";
import { Loading, Note, PageHead, Stat, usePageData } from "./thread";
import "./respond.css";

interface Line {
  shift: string; date: string; pilot: string; scheduled_h: number; staffed_h: number; billable_h: number; held_h: number; excluded_h: number;
  amount_usd: number; notes: string[]; held_for: string[]; lapsed: boolean; log_sha256: string | null;
}
interface Totals { scheduled_h: number; staffed_h: number; billable_h: number; held_h: number; excluded_h: number; amount_usd: number; held_usd: number }
interface Report {
  label: string; shifts: number; scheduled_h: number; staffed_h: number; staffed_pct: number;
  gaps: { date: string; hours: number; why: string }[];
  calls: number; flights: number; declined: Record<string, number>;
  response: { launch_median_s: number | null; launch_p90_s: number | null; scene_median_s: number | null; scene_p90_s: number | null };
  pilots: { pilot: string; shifts: number; hours: number; flights: number }[];
  mishaps: { id: string; date: string; tail: string; kind: string; written: boolean; faa: boolean | null }[];
  records_open: string[]; not_current: string[];
  currency: { pilots: number; solo: number; not_assignable: number; warnings: string[] };
  care: { checks: number; overdue: string[]; grounded: string[] };
}
interface Month {
  source: string; today: string;
  role: { supervisor: boolean; pilot: boolean; contractor: boolean };
  report: Report;
  invoice: { number: string; label: string; contractor: string; rate_usd: number; lines: Line[]; totals: Totals };
  status: "draft" | "submitted" | "approved" | "returned";
  submitted: { by: string; at: string; totals: Totals; sha256: string; hash: string } | null;
  decided: { by: string; at: string; note: string; hash: string } | null;
  history: { at: string; by: string; what: string }[];
  changed_since_submit: boolean;
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mmss = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const STATUS = { draft: "Not yet submitted", submitted: "Submitted, waiting on the program manager", approved: "Approved for payment", returned: "Returned to the contractor" } as const;

/** The month's close: the activity report the agency reads and the invoice it pays, both built from the signed shift logs. */
export function ContractPage({ onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const page = usePageData<Month>("/v1/dfr/program", onBanner);
  const [note, setNote] = useState("");
  const [all, setAll] = useState(false);
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;
  const r = d.report;
  const inv = d.invoice;
  const act = (action: string, args: Record<string, unknown> = {}) => page.post("/v1/dfr/act", action, args);
  const flagged = inv.lines.filter((l) => l.notes.length);
  const lines = all ? inv.lines : flagged;
  const canSubmit = d.role.contractor && (d.status === "draft" || d.status === "returned");
  const canDecide = d.role.supervisor && d.status === "submitted";

  return (
    <section className="page ins-page co-page ops-page rs-page" data-testid="contract">
      <PageHead kicker="Harbor police DFR program (SIM)" title="Report and invoice" lede={`${r.label}: what the console did, and what the contractor bills for it. Both come from the signed shift logs, so neither side types the numbers. Unstaffed hours and hours worked by a pilot who was not current are not payable; a shift whose flight records are not filed is held until they are.`} />
      <p className="ins-source">{d.source}</p>
      <Note note={page.note} />
      <div className="th-stats">
        <Stat label="Console hours staffed" value={`${r.staffed_h} of ${r.scheduled_h}`} hint={`${r.staffed_pct}% of scheduled`} />
        <Stat label="Median call to on scene" value={mmss(r.response.scene_median_s)} hint={`90th percentile ${mmss(r.response.scene_p90_s)}`} />
        <Stat label="Payable" value={usd(inv.totals.amount_usd)} hint={`${inv.totals.billable_h} h at ${usd(inv.rate_usd)}`} />
        <Stat label="Held or not payable" value={`${inv.totals.held_h + inv.totals.excluded_h} h`} hint={`${inv.totals.held_h} h held, ${inv.totals.excluded_h} h not payable`} />
      </div>

      <section className="panel" aria-labelledby="ct-status" data-testid="month-status">
        <div className="panel-head"><h2 id="ct-status">{inv.number}, {inv.label}</h2><span className={`th-check ${d.status === "approved" ? "is-ok" : d.status === "returned" ? "is-fail" : "is-warn"}`}>{STATUS[d.status]}</span></div>
        <p className="meta">{inv.contractor} bills the agency for console hours at {usd(inv.rate_usd)} an hour.</p>
        {d.submitted ? <p className="meta">Submitted {d.submitted.at.slice(0, 16).replace("T", " ")}Z by {d.submitted.by}: {usd(d.submitted.totals.amount_usd)} for {d.submitted.totals.billable_h} h. <span className="mono">sha256 {d.submitted.hash.slice(0, 12)}…</span></p> : null}
        {d.changed_since_submit && d.status === "submitted" ? <p className="rs-alert is-caution" role="status">The numbers have changed since it was submitted (a held record was filed, or a file was corrected). Return it so the contractor resubmits the current figures.</p> : null}
        {d.decided?.note ? <p className="meta">{d.status === "returned" ? "Returned" : "Approved"} by {d.decided.by}: {d.decided.note}</p> : null}
        <div className="rs-actions">
          {canSubmit ? <button type="button" className="btn btn-primary" disabled={page.busy} onClick={() => void act("month.submit")}>{d.status === "returned" ? "Resubmit" : "Submit"} the report and invoice</button> : null}
          {!d.role.contractor && (d.status === "draft" || d.status === "returned") ? <span className="meta">The contractor submits the month; the program manager approves it.</span> : null}
          {canDecide ? (
            <>
              <button type="button" className="btn btn-primary" disabled={page.busy} onClick={() => void act("month.approve", { note })}>Approve for payment</button>
              <input type="text" className="rs-grow" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What needs fixing (required to return)" aria-label="Note for the contractor" />
              <button type="button" className="btn btn-quiet" disabled={page.busy || note.trim().length < 6} onClick={() => void act("month.return", { note }).then((ok) => ok && setNote(""))}>Return with this note</button>
            </>
          ) : null}
          {d.status === "submitted" && !d.role.supervisor ? <span className="meta">Waiting on the program manager.</span> : null}
        </div>
        {d.history.length ? <ul className="rs-disc">{d.history.map((h) => <li key={h.at + h.what}><span className="mono meta">{h.at.slice(0, 16).replace("T", " ")}Z</span> {h.what} <span className="meta">{h.by}</span></li>)}</ul> : null}
      </section>

      <div className="rs-stack">
        <section className="panel" aria-labelledby="ct-report" data-testid="activity-report">
          <div className="panel-head"><h2 id="ct-report">Activity report</h2><span className="meta">{r.shifts} shifts</span></div>
          <dl className="rs-fields">
            <div><dt>Calls received</dt><dd>{r.calls}</dd></div>
            <div><dt>Flights</dt><dd>{r.flights}</dd></div>
            <div><dt>Not flown</dt><dd>{Object.entries(r.declined).map(([k, v]) => `${k} ${v}`).join(", ") || "None"}</dd></div>
            <div><dt>Call to launch</dt><dd>median {mmss(r.response.launch_median_s)}, 90th percentile {mmss(r.response.launch_p90_s)}</dd></div>
            <div><dt>Coverage gaps</dt><dd>{r.gaps.length ? r.gaps.map((g) => `${g.date}: ${g.hours} h`).join("; ") : "None"}</dd></div>
            <div><dt>Mishaps</dt><dd>{r.mishaps.length ? r.mishaps.map((m) => `${m.id} ${m.date}, ${m.tail} ${m.kind.toLowerCase()}${m.faa ? ", FAA reportable" : m.written ? ", not reportable" : ", written report open"}`).join("; ") : "None"}</dd></div>
            <div><dt>Flight records open</dt><dd>{r.records_open.length ? <a href="#records">{r.records_open.join(", ")}</a> : "All filed"}</dd></div>
            <div><dt>Aircraft care</dt><dd>{r.care.checks} weekly checks signed{r.care.overdue.length ? `; overdue: ${r.care.overdue.join(", ")}` : ""}{r.care.grounded.length ? `; grounded: ${r.care.grounded.join(", ")}` : ""}</dd></div>
            <div><dt>Pilot currency now</dt><dd>{r.currency.solo} of {r.currency.pilots} cleared for solo, {r.currency.not_assignable} cannot be rostered</dd></div>
          </dl>
          {r.not_current.length || r.currency.warnings.length ? (
            <ul className="rs-checks">
              {r.not_current.map((w) => <li key={w} className="th-check is-fail">{w}</li>)}
              {r.currency.warnings.map((w) => <li key={w} className="th-check is-warn">{w}</li>)}
            </ul>
          ) : null}
          <div className="table-wrap" tabIndex={0}>
            <table>
              <thead><tr><th>Pilot</th><th>Shifts</th><th>Hours</th><th>Flights</th></tr></thead>
              <tbody>{r.pilots.map((p) => <tr key={p.pilot}><td>{p.pilot}</td><td className="mono">{p.shifts}</td><td className="mono">{p.hours}</td><td className="mono">{p.flights}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className="panel" aria-labelledby="ct-invoice" data-testid="invoice">
          <div className="panel-head">
            <h2 id="ct-invoice">Invoice lines</h2>
            <button type="button" className="btn btn-quiet" aria-pressed={all} onClick={() => setAll((x) => !x)}>{all ? `Only the ${flagged.length} with a note` : `All ${inv.lines.length} shifts`}</button>
          </div>
          <div className="table-wrap" tabIndex={0}>
            <table>
              <thead><tr><th>Shift</th><th>Pilot</th><th>Staffed</th><th>Payable</th><th>Amount</th><th>Note</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.shift} className={l.excluded_h || l.held_h ? "th-row-fail" : undefined} data-shift={l.shift}>
                    <td className="mono">{l.date}</td>
                    <td>{l.pilot}</td>
                    <td className="mono">{l.staffed_h} of {l.scheduled_h} h</td>
                    <td className="mono">{l.billable_h} h</td>
                    <td className="mono">{usd(l.amount_usd)}</td>
                    <td>{l.notes.map((n) => <span key={n} className={`th-check ${l.held_h ? "is-warn" : "is-fail"}`}>{n}</span>)}{l.held_for.length ? <a href="#records" className="meta"> File it</a> : null}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th scope="row">Total</th><td /><td className="mono">{inv.totals.staffed_h} of {inv.totals.scheduled_h} h</td><td className="mono">{inv.totals.billable_h} h</td><td className="mono">{usd(inv.totals.amount_usd)}</td><td className="meta">{inv.totals.held_h} h held ({usd(inv.totals.held_usd)}) carry to the next invoice once filed</td></tr>
              </tfoot>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}
