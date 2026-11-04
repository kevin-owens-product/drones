// Visit alerts for the hosted demo: Kevin gets a phone notification (ntfy) when
// someone opens the invite link, which console pages that visitor opens, and
// when someone reads the /why/ note.
//
// The ntfy topic is a build-time secret (VITE_NTFY_TOPIC, set in the Render
// dashboard), never in the repo: ntfy topics are readable by anyone who knows
// the name. Without it, or off the production host, nothing is sent. Alerts
// carry the page, the device type, the time zone and the referring site; no
// IP, cookie, fingerprint or form input. `?mute` on any page silences this
// browser (for Kevin's own devices); `?unmute` turns it back on.

const TOPIC = import.meta.env.VITE_NTFY_TOPIC;
const HOST = "drones.productexec.co";
const MUTE = "dmc-notify-mute";
const INVITED = "dmc-invited";
const SENT = "dmc-notify-sent";

function store(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function applyMuteParam(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.has("mute")) store("local")?.setItem(MUTE, "1");
  if (params.has("unmute")) store("local")?.removeItem(MUTE);
}
applyMuteParam();

function live(): boolean {
  return Boolean(TOPIC) && window.location.hostname === HOST && store("local")?.getItem(MUTE) !== "1";
}

function context(): string {
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "phone or tablet" : "desktop";
  let zone = "";
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* no zone */
  }
  let from = "";
  try {
    from = document.referrer ? new URL(document.referrer).hostname : "";
  } catch {
    /* no referrer */
  }
  return [mobile, zone, from && from !== HOST ? `from ${from}` : "", invited() ? "invited visitor" : ""].filter(Boolean).join(" · ");
}

/** Send one alert. `once` keys an alert so it fires at most once per browser tab session. */
export function notify(title: string, body: string, once?: string): void {
  if (!live()) return;
  const sent = store("session");
  if (once) {
    const seen = new Set((sent?.getItem(SENT) ?? "").split("|"));
    if (seen.has(once)) return;
    seen.add(once);
    sent?.setItem(SENT, [...seen].filter(Boolean).join("|"));
  }
  void fetch(`https://ntfy.sh/${encodeURIComponent(TOPIC ?? "")}`, {
    method: "POST",
    body: `${body}\n${context()}`,
    headers: { Title: title.replace(/[^\x20-\x7e]/g, ""), Tags: "eyes" },
    keepalive: true,
  }).catch(() => undefined);
}

/** Remember that this browser came in through an invite link. */
export function markInvited(): void {
  store("local")?.setItem(INVITED, "1");
}

export function invited(): boolean {
  return store("local")?.getItem(INVITED) === "1";
}
