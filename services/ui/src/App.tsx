import { useEffect, useState, type FormEvent } from "react";
import { api, sessionLost, type SessionConfig } from "./api";
import { AccessPage } from "./pages/Access";
import { AttritionPage } from "./pages/Attrition";
import { AuditPage } from "./pages/Audit";
import { BriefPage } from "./pages/Brief";
import { CompanyPage } from "./pages/Company";
import { ConfigurePage } from "./pages/Configure";
import { DebriefPage } from "./pages/Debrief";
import { DenialMapPage } from "./pages/DenialMap";
import { EvalPage } from "./pages/Eval";
import { FieldReportsPage } from "./pages/FieldReports";
import { FleetPage } from "./pages/Fleet";
import { MissionsPage } from "./pages/Missions";
import { OperatePage } from "./operate/Operate";
import { Login } from "./shell/Login";
import { Shell } from "./shell/Shell";
import type { Section, Viewer } from "./shell/types";

const SECTIONS: readonly Section[] = [
  "operate",
  "fleet",
  "company",
  "missions",
  "debrief",
  "eval",
  "attrition",
  "reports",
  "denial",
  "configure",
  "brief",
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
    void api<Viewer>("/v1/me")
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
    <Shell banner={banner} viewer={viewer} section={section} onSection={onSection} onLogout={() => void onLogout()}>
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
      {section === "brief" ? <BriefPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "access" ? <AccessPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "audit" ? <AuditPage viewer={viewer} onBanner={setBanner} /> : null}
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
