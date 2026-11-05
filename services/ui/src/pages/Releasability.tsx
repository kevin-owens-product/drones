import type { Viewer } from "../shell/types";
import { Loading, PageHead, Stat, usePageData, Withheld } from "./thread";
import "./market.css";

interface ReleaseView {
  source: string; test: string;
  rules: { field: string; label: string; reason: string }[];
  tenants: { org: string; name: string; country: string; marking: string; hosting: string; withheld: number }[];
  you: { org: string; name: string; country: string; marking: string; hosting: string } | null;
}

/** Releasability rules applied at the API: what each tenant never receives, and why. */
export function ReleasabilityPage({ onBanner }: { viewer: Viewer; onBanner: (banner: string) => void }) {
  const page = usePageData<ReleaseView>("/v1/release", onBanner);
  if (!page.data) return <Loading fault={page.fault} />;
  const d = page.data;

  return (
    <section className="page ins-page co-page ops-page" data-testid="release" tabIndex={0}>
      <PageHead
        kicker={d.you ? "Your tenant" : "Neros commercial"}
        title="Releasability"
        lede="Allied buyers run on the same platform, and an allied tenant must never receive data its rules withhold. The field is removed before the response leaves the server, at any depth, and every page tells the allied user what was withheld and why. Hiding a column on screen would not be enough."
      />
      <p className="ins-source">{d.source}</p>
      <Withheld data={d} />

      <div className="th-stats">
        <Stat label="Fields withheld from allied tenants" value={String(d.rules.length)} />
        <Stat label="Tenants" value={String(d.tenants.length)} hint={`${d.tenants.filter((t) => t.country !== "US").length} allied`} />
        {d.you ? <Stat label="Your marking" value={d.you.marking} hint={d.you.hosting} /> : null}
      </div>

      <section className="panel">
        <div className="panel-head"><h2>Withheld from allied sessions</h2></div>
        <div className="table-wrap" tabIndex={0}>
          <table data-testid="release-rules">
            <thead><tr><th>Field</th><th>What it is</th><th>Why</th></tr></thead>
            <tbody>
              {d.rules.map((r) => <tr key={r.field}><td className="mono">{r.field}</td><td>{r.label}</td><td className="meta">{r.reason}</td></tr>)}
            </tbody>
          </table>
        </div>
        <p className="meta">{d.test}</p>
      </section>

      {!d.you ? (
        <section className="panel">
          <div className="panel-head"><h2>Tenants</h2></div>
          <div className="table-wrap" tabIndex={0}>
            <table data-testid="release-tenants">
              <thead><tr><th>Tenant</th><th>Country</th><th>Marking</th><th>Hosting</th><th>Fields withheld</th></tr></thead>
              <tbody>
                {d.tenants.map((t) => <tr key={t.org}><td>{t.name}</td><td>{t.country}</td><td>{t.marking}</td><td>{t.hosting}</td><td className="mono">{t.withheld}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p className="meta">The sovereign profile is defined, not stood up: the bid desk reads it as partial until it is.</p>
        </section>
      ) : null}
    </section>
  );
}
