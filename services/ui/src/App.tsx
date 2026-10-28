import { useEffect, useState, type FormEvent } from "react";
import { api, type PlatformRow, type SessionConfig } from "./api";

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

export function App() {
  const [banner, setBanner] = useState("CUI");
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [me, setMe] = useState<string>("");
  const [rows, setRows] = useState<PlatformRow[]>([]);
  const [fault, setFault] = useState("");
  const [exportResult, setExportResult] = useState("");

  useEffect(() => {
    void api<SessionConfig>("/v1/session/config")
      .then(({ banner: next, body }) => {
        setBanner(next);
        setConfig(body);
      })
      .catch((error: unknown) => setFault(error instanceof Error ? error.message : "config failed"));
  }, []);

  async function refresh() {
    const who = await api<{ username: string }>("/v1/me");
    setMe(who.body.username);
    setBanner(who.banner);
    const fleet = await api<{ items: PlatformRow[] }>("/v1/platforms");
    setRows(fleet.body.items);
    setBanner(fleet.banner);
  }

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setFault("");
    try {
      await api("/v1/session/dev-login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      await refresh();
    } catch (error) {
      setFault(error instanceof Error ? error.message : "login failed");
    }
  }

  async function onExport(id: string) {
    setExportResult("");
    try {
      const result = await api<{ allowed: boolean; banner: string }>("/v1/exports", {
        method: "POST",
        body: JSON.stringify({
          resource_type: "platform",
          resource_id: id,
          recipient_user_id: "22222222-2222-4222-8222-222222222202",
          purpose: "console self-check",
          format: "json",
        }),
      });
      setBanner(result.banner);
      setExportResult(result.body.allowed ? "export allowed" : "export denied");
    } catch (error) {
      setExportResult(error instanceof Error ? error.message : "export failed");
    }
  }

  return (
    <>
      <header id="banner" className={bannerClass(banner)}>{banner}</header>
      <main>
        <h1>A2E Mission Cloud</h1>
        <p>Sensor custody and navigation only. No weapons employment.</p>
        {fault ? <p className="fault" id="fault">{fault}</p> : null}
        {!me && config?.dev_login ? (
          <form id="login-form" onSubmit={(event) => void onLogin(event)}>
            <input id="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
            <button type="submit">Sign in</button>
          </form>
        ) : null}
        {!me && config && !config.dev_login ? (
          <p><a href={config.login_url}>Sign in with organization IdP</a></p>
        ) : null}
        {me ? (
          <>
            <p id="who">Signed in as {me}</p>
            <table id="fleet">
              <thead>
                <tr><th>Tail</th><th>Designation</th><th>Group</th><th>Portion</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.tail_number}</td>
                    <td>{row.designation}</td>
                    <td>{row.group_size}</td>
                    <td>{row.portion_mark}</td>
                    <td>{row.airworthiness}</td>
                    <td><button type="button" onClick={() => void onExport(row.id)}>Export</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p id="export-result">{exportResult}</p>
          </>
        ) : null}
      </main>
      <footer className={`${bannerClass(banner)} banner-bottom`}>{banner}</footer>
    </>
  );
}
