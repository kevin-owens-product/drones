import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { invited, markInvited, notify } from "./notify";
import { api, sessionLost, type SessionConfig } from "./api";
import { OperatePage } from "./operate/Operate";
import { OpsPage } from "./pages/Ops";
import { Login } from "./shell/Login";

// Operate and the work queue are the two home pages, so they ship with the shell; every other page loads
// the first time it opens. Each is a few kilobytes; the shell no longer carries all thirty at once.
const AccessPage = lazy(() => import("./pages/Access").then((m) => ({ default: m.AccessPage })));
const AttritionPage = lazy(() => import("./pages/Attrition").then((m) => ({ default: m.AttritionPage })));
const AuditPage = lazy(() => import("./pages/Audit").then((m) => ({ default: m.AuditPage })));
const BriefPage = lazy(() => import("./pages/Brief").then((m) => ({ default: m.BriefPage })));
const CompanyPage = lazy(() => import("./pages/Company").then((m) => ({ default: m.CompanyPage })));
const ConfigurePage = lazy(() => import("./pages/Configure").then((m) => ({ default: m.ConfigurePage })));
const DebriefPage = lazy(() => import("./pages/Debrief").then((m) => ({ default: m.DebriefPage })));
const PhysicsCheckPage = lazy(() => import("./pages/PhysicsCheck").then((m) => ({ default: m.PhysicsCheckPage })));
const DenialMapPage = lazy(() => import("./pages/DenialMap").then((m) => ({ default: m.DenialMapPage })));
const EvalPage = lazy(() => import("./pages/Eval").then((m) => ({ default: m.EvalPage })));
const FieldReportsPage = lazy(() => import("./pages/FieldReports").then((m) => ({ default: m.FieldReportsPage })));
const FleetPage = lazy(() => import("./pages/Fleet").then((m) => ({ default: m.FleetPage })));
const MissionsPage = lazy(() => import("./pages/Missions").then((m) => ({ default: m.MissionsPage })));
const PortalPage = lazy(() => import("./pages/Portal").then((m) => ({ default: m.PortalPage })));
const QualityPage = lazy(() => import("./pages/Quality").then((m) => ({ default: m.QualityPage })));
const ReceivingPage = lazy(() => import("./pages/Receiving").then((m) => ({ default: m.ReceivingPage })));
const AccountabilityPage = lazy(() => import("./pages/Accountability").then((m) => ({ default: m.AccountabilityPage })));
const CompliancePage = lazy(() => import("./pages/Compliance").then((m) => ({ default: m.CompliancePage })));
const ReadinessPage = lazy(() => import("./pages/Readiness").then((m) => ({ default: m.ReadinessPage })));
const ProgramPage = lazy(() => import("./pages/Program").then((m) => ({ default: m.ProgramPage })));
const UpdatesPage = lazy(() => import("./pages/Updates").then((m) => ({ default: m.UpdatesPage })));
const IntegrationsPage = lazy(() => import("./pages/Integrations").then((m) => ({ default: m.IntegrationsPage })));
const QuotePage = lazy(() => import("./pages/Quote").then((m) => ({ default: m.QuotePage })));
const SurgePage = lazy(() => import("./pages/Surge").then((m) => ({ default: m.SurgePage })));
const BidDeskPage = lazy(() => import("./pages/BidDesk").then((m) => ({ default: m.BidDeskPage })));
const CasesPage = lazy(() => import("./pages/Cases").then((m) => ({ default: m.CasesPage })));
const StockpilePage = lazy(() => import("./pages/Stockpile").then((m) => ({ default: m.StockpilePage })));
const PlansPage = lazy(() => import("./pages/Plans").then((m) => ({ default: m.PlansPage })));
const ReleasabilityPage = lazy(() => import("./pages/Releasability").then((m) => ({ default: m.ReleasabilityPage })));
const MixedFleetPage = lazy(() => import("./pages/MixedFleet").then((m) => ({ default: m.MixedFleetPage })));
const ConfigurationPage = lazy(() => import("./pages/Configuration").then((m) => ({ default: m.ConfigurationPage })));

import { Shell } from "./shell/Shell";
import type { Section, Viewer } from "./shell/types";
import { homeOf, navFor, rememberWorkspace, sectionsFor, workspaceOf, type Workspace } from "./shell/workspace";

const SECTIONS: readonly Section[] = [
  "operate",
  "ops",
  "supply",
  "fleet",
  "company",
  "missions",
  "debrief",
  "eval",
  "attrition",
  "reports",
  "denial",
  "configure",
  "physics",
  "brief",
  "receiving",
  "accountability",
  "quality",
  "compliance",
  "readiness",
  "program",
  "updates",
  "integrations",
  "quote",
  "surge",
  "bid",
  "cases",
  "stockpile",
  "plans",
  "release",
  "mixed",
  "config",
  "access",
  "audit",
];

// Pages folded into others in the Admin clean-up; old links land on the page that replaced them.
const MOVED: Record<string, Section> = {
  overview: "operate",
  live: "operate",
  video: "operate",
  organization: "access",
  people: "access",
  sharing: "access",
};

function bannerClass(text: string): string {
  const level = text.startsWith("TOP SECRET")
    ? "TOP_SECRET"
    : text.startsWith("SECRET")
      ? "SECRET"
      : text.startsWith("CONFIDENTIAL")
        ? "CONFIDENTIAL"
        : text.startsWith("CUI")
          ? "CUI"
          : "UNCLASSIFIED";
  return `banner banner-${level}`;
}

function sectionFromHash(): Section {
  const raw = window.location.hash.replace(/^#/, "");
  return SECTIONS.find((item) => item === raw) ?? MOVED[raw] ?? "operate";
}

/**
 * One-link access for the hosted demo: `?invite=<base64url of user:password>`
 * signs that account in and then drops the parameter from the address bar, so
 * an invitee gets one link instead of a username and password to type. The
 * hosted gate is a browser-side courtesy, not a security boundary, so the link
 * carries no more than the password would.
 */
async function signInFromInvite(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("invite");
  if (!token) return;
  params.delete("invite");
  const rest = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  try {
    const plain = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
    const at = plain.indexOf(":");
    if (at < 1) return;
    await api("/v1/session/dev-login", {
      method: "POST",
      body: JSON.stringify({ username: plain.slice(0, at), password: plain.slice(at + 1) }),
    });
    markInvited();
    notify("Invite link opened", `Signed in as ${plain.slice(0, at)} from the invite link.`, `invite-${plain.slice(0, at)}`);
  } catch {
    /* a stale or mistyped link falls back to the sign-in form */
  }
}

export function App() {
  const [banner, setBanner] = useState("CUI");
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [fault, setFault] = useState("");
  const [section, setSection] = useState<Section>(() => {
    const moved = MOVED[window.location.hash.replace(/^#/, "")];
    if (moved) window.history.replaceState(null, "", `#${moved}`);
    return sectionFromHash();
  });

  useEffect(() => {
    void api<SessionConfig>("/v1/session/config")
      .then(({ banner: next, body }) => {
        setBanner(next);
        setConfig(body);
      })
      .catch((error: unknown) => setFault(error instanceof Error ? error.message : "config failed"));
    void signInFromInvite()
      .then(() => api<Viewer>("/v1/me"))
      .then(({ banner: next, body }) => {
        setBanner(next);
        setViewer(body);
      })
      .catch(() => setViewer(null));
  }, []);

  useEffect(() => {
    function onLost() {
      setViewer(null);
      setFault("The session ended. Sign in again.");
    }
    sessionLost.addEventListener("lost", onLost);
    return () => sessionLost.removeEventListener("lost", onLost);
  }, []);

  useEffect(() => {
    function onHash() {
      const raw = window.location.hash.replace(/^#/, "");
      const moved = MOVED[raw];
      if (moved) window.history.replaceState(null, "", `#${moved}`);
      setSection(sectionFromHash());
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function onSection(next: Section) {
    window.location.hash = next;
    setSection(next);
  }

  // Each organization sees its own workspace; a section outside it lands on that workspace's home.
  const [workspace, setWorkspace] = useState<Workspace>("all");
  useEffect(() => {
    if (viewer) setWorkspace(workspaceOf(viewer));
  }, [viewer]);
  useEffect(() => {
    if (!viewer) return;
    const w = workspaceOf(viewer);
    // A bare address, or a page outside this workspace, lands on this person's home.
    if (!window.location.hash || !sectionsFor(w).includes(section)) {
      const home = homeOf(w, viewer);
      window.history.replaceState(null, "", `#${home}`);
      setSection(home);
    }
  }, [viewer, workspace, section]);

  // Visit alerts: which console pages an invited visitor opens, each once per tab.
  useEffect(() => {
    if (!viewer || !invited() || !sectionsFor(workspace).includes(section) || window.location.hash !== `#${section}`) return;
    const label = [...navFor("neros"), ...navFor("customer")].find((n) => n.id === section)?.label ?? section;
    notify(`Viewed ${label}`, `Opened ${label} in the console as ${viewer.display_name}.`, `page-${section}`);
  }, [viewer, section, workspace]);

  function onWorkspace(next: Workspace) {
    rememberWorkspace(next);
    setWorkspace(next);
    onSection(homeOf(next, viewer ?? undefined));
  }

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setFault("");
    try {
      await api("/v1/session/dev-login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      const who = await api<Viewer>("/v1/me");
      setBanner(who.banner);
      setViewer(who.body);
    } catch (error) {
      setFault(error instanceof Error ? error.message : "login failed");
    }
  }

  async function onLogout() {
    try {
      await api("/v1/session/logout", { method: "POST" });
    } catch {
      /* the cookie is cleared locally either way */
    }
    setViewer(null);
  }

  const page = viewer ? (
    <Shell banner={banner} viewer={viewer} section={section} onSection={onSection} workspace={workspace} onWorkspace={onWorkspace} onLogout={() => void onLogout()}>
      {section === "ops" ? <OpsPage viewer={viewer} onBanner={setBanner} /> : null}
      <Suspense fallback={<section className="page" aria-busy="true"><p className="meta">Loading…</p></section>}>
      {section === "supply" ? <PortalPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "operate" ? <OperatePage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "fleet" ? <FleetPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "company" ? <CompanyPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "missions" ? <MissionsPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "debrief" ? <DebriefPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "eval" ? <EvalPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "attrition" ? <AttritionPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "reports" ? <FieldReportsPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "denial" ? <DenialMapPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "configure" ? <ConfigurePage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "physics" ? <PhysicsCheckPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "brief" ? <BriefPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "receiving" ? <ReceivingPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "accountability" ? <AccountabilityPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "quality" ? <QualityPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "compliance" ? <CompliancePage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "readiness" ? <ReadinessPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "program" ? <ProgramPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "updates" ? <UpdatesPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "integrations" ? <IntegrationsPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "quote" ? <QuotePage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "surge" ? <SurgePage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "bid" ? <BidDeskPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "cases" ? <CasesPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "stockpile" ? <StockpilePage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "plans" ? <PlansPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "release" ? <ReleasabilityPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "mixed" ? <MixedFleetPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "config" ? <ConfigurationPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "access" ? <AccessPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "audit" ? <AuditPage viewer={viewer} onBanner={setBanner} /> : null}
      </Suspense>
    </Shell>
  ) : (
    <Login
      bannerClass={bannerClass}
      banner={banner}
      config={config}
      fault={fault}
      username={username}
      password={password}
      onUsername={setUsername}
      onPassword={setPassword}
      onSubmit={(event) => void onLogin(event)}
    />
  );

  return (
    <>
      <header id="banner" className={bannerClass(banner)}>
        {banner}
      </header>
      {page}
      <footer className={`${bannerClass(banner)} banner-bottom`}>{banner}</footer>
    </>
  );
}
