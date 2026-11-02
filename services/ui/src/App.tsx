import { useEffect, useState, type FormEvent } from "react";
import { api, sessionLost, type SessionConfig } from "./api";
import { AuditPage } from "./pages/Audit";
import { DebriefPage } from "./pages/Debrief";
import { FleetPage } from "./pages/Fleet";
import { LivePage } from "./pages/Live";
import { MissionsPage } from "./pages/Missions";
import { OrganizationPage } from "./pages/Organization";
import { OverviewPage } from "./pages/Overview";
import { PeoplePage } from "./pages/People";
import { SharingPage } from "./pages/Sharing";
import { VideoPage } from "./pages/Video";
import { Login } from "./shell/Login";
import { Shell } from "./shell/Shell";
import type { Section, Viewer } from "./shell/types";

const SECTIONS: readonly Section[] = [
  "overview",
  "live",
  "fleet",
  "video",
  "missions",
  "debrief",
  "organization",
  "people",
  "sharing",
  "audit",
];

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
  return SECTIONS.find((item) => item === raw) ?? "overview";
}

export function App() {
  const [banner, setBanner] = useState("CUI");
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [fault, setFault] = useState("");
  const [section, setSection] = useState<Section>(sectionFromHash);

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
      {section === "overview" ? <OverviewPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "live" ? <LivePage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "fleet" ? <FleetPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "video" ? <VideoPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "missions" ? <MissionsPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "debrief" ? <DebriefPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "organization" ? <OrganizationPage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "people" ? <PeoplePage viewer={viewer} onBanner={setBanner} /> : null}
      {section === "sharing" ? <SharingPage viewer={viewer} onBanner={setBanner} /> : null}
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
