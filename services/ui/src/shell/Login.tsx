import type { FormEvent, JSX } from "react";
import { FloorField } from "./FloorField";

export function Login(props: {
  bannerClass: (text: string) => string;
  banner: string;
  config: { login_url: string; dev_login: boolean } | null;
  fault: string;
  username: string;
  password: string;
  onUsername: (v: string) => void;
  onPassword: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
}): JSX.Element {
  return (
    <div className="gate" data-marking={props.bannerClass(props.banner)}>
      <FloorField />
      <div className="gate-stage">
        <section className="gate-copy">
          <div className="brand">
            A2E
            <span className="kicker">Mission Cloud</span>
          </div>
          <h1>
            <span>Plan, watch, and debrief.</span>
            <span>Humans approve every tasking change.</span>
            <span>No weapons employment.</span>
          </h1>
          <p className="meta">{props.banner}</p>
        </section>
        <section className="gate-aside">
          <div className="panel gate-card">
            <p className="kicker">Access</p>
            <h2>Sign in</h2>
            {props.fault ? (
              <p className="fault" id="fault">
                {props.fault}
              </p>
            ) : null}
            {props.config ? (
              <a id="idp-login" className="btn btn-primary" href={props.config.login_url}>
                Sign in with organization IdP
              </a>
            ) : (
              <p className="meta">Session configuration is loading.</p>
            )}
            {props.config?.dev_login ? (
              <form id="login-form" onSubmit={props.onSubmit}>
                <div className="kicker">Development</div>
                <div className="field">
                  <label htmlFor="username">Username</label>
                  <input
                    id="username"
                    name="username"
                    value={props.username}
                    onChange={(event) => props.onUsername(event.target.value)}
                    autoComplete="username"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                </div>
                <div className="field">
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    value={props.password}
                    onChange={(event) => props.onPassword(event.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <button className="btn btn-primary" type="submit">
                  Sign in
                </button>
              </form>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
