# Persona journey swarm

One browser bot per persona, all at once, each walking that persona's journey the way a person would:
the public site first, then sign-in (the invite link for `admin` and `allied`, the form for the rest),
every page in their rail, every enabled button on each page, the command palette, the Neros-to-customer
switch for admin, and log out. Each persona also runs a phone-width twin (390 px) that walks the rail
through the menu drawer.

What it records, one JSON line per finding:

| kind | what a person hit |
|---|---|
| `page-error`, `console-error`, `http-error` | something broke |
| `broken-link`, `missing-anchor`, `broken-image`, `deep-link-dead` | the public site points nowhere |
| `wrong-home`, `token-in-url`, `bad-login-feedback`, `logout-broken` | sign-in and sign-out |
| `dead-button` | pressing it changed nothing and called nothing |
| `offered-but-refused` | the button was enabled but the role is refused (it should be disabled with a reason) |
| `action-failed`, `action-rejected` | the action errored, or was refused for input the UI let through |
| `unclickable`, `rail-unclickable` | something sits on top of the control |
| `disabled-without-reason` | a disabled button with no tooltip saying why |
| `not-actionable`, `blank-page`, `empty-table`, `no-heading` | the page gives the person nothing to do or no explanation |
| `tenant-leak`, `workspace-leak` | another customer's ids or names, or the other workspace's pages |
| `sideways-scroll`, `drawer-stays-open` | layout at desktop or phone width |

Run it against the static build (what Render serves), never with write actions against the live site:

```sh
npm run build:static
node e2e/swarm/serve.mjs 4180 &
SWARM_LOGINS=/path/to/demo-logins.md node e2e/swarm/run.mjs --out /tmp/swarm
```

Logins come from a markdown table (`| user | password | ...`) outside the repo. `--only commander` runs one
persona, `--read-only` looks without pressing anything (safe for the live site), `--base` points it elsewhere.
A full run takes about ten minutes on four cores.
