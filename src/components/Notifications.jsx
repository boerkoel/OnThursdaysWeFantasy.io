import React, { useEffect, useState } from "react";
import { TeamLogo } from "./LiveBits.jsx";

// Notifications panel: choose what to follow and turn alerts on for this
// phone. Subscriptions and choices are stored by the alert service (worker/),
// which pushes new events every couple of minutes.
const SERVICE = "https://otwf-notify.otwf.workers.dev";
const PREFS_KEY = "notificationPrefs";

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const installed = () => window.navigator.standalone || window.matchMedia?.("(display-mode: standalone)").matches;

function loadPrefs() {
  try { return { wire: true, deathWatch: false, teams: [], ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; }
  catch { return { wire: true, deathWatch: false, teams: [] }; }
}
function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}
const keyBytes = base64 => {
  const padded = base64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((base64.length + 3) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
};
async function post(path, body) {
  const response = await fetch(SERVICE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
  return response.json();
}

export default function Notifications({ teams }) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const [subscription, setSubscription] = useState(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported()) return;
    navigator.serviceWorker.getRegistration().then(reg => reg?.pushManager.getSubscription()).then(sub => setSubscription(sub || null)).catch(() => {});
  }, []);

  const run = async (label, task) => {
    setBusy(true);
    setStatus(label);
    try { setStatus(await task()); } catch (error) { setStatus("Something went wrong: " + error.message); } finally { setBusy(false); }
  };

  const turnOn = () => run("Turning on…", async () => {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "Notifications are blocked. Allow them in Settings → Notifications → Thursdays.";
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await (await fetch(SERVICE + "/vapid-public-key")).json();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    await post("/subscribe", { subscription: sub.toJSON(), prefs });
    setSubscription(sub);
    return "Notifications are on.";
  });

  const turnOff = () => run("Turning off…", async () => {
    await post("/unsubscribe", { subscription: subscription.toJSON() }).catch(() => {});
    await subscription.unsubscribe();
    setSubscription(null);
    return "Notifications are off.";
  });

  const update = next => {
    setPrefs(next);
    savePrefs(next);
    if (subscription) run("Saving…", async () => { await post("/subscribe", { subscription: subscription.toJSON(), prefs: next }); return "Saved."; });
  };
  const toggleTeam = id => update({ ...prefs, teams: prefs.teams.includes(id) ? prefs.teams.filter(t => t !== id) : [...prefs.teams, id] });

  let body;
  if (!supported()) {
    body = <p className="median-note">{isIos() && !installed()
      ? "On iPhone, notifications work in the home-screen app: tap Share → Add to Home Screen, then open Thursdays from your home screen."
      : "This browser doesn't support notifications."}</p>;
  } else {
    body = <>
      <div className="notify-options">
        <label><input type="checkbox" checked={prefs.wire} onChange={e => update({ ...prefs, wire: e.target.checked })} /> League Wire highlights <small>lead changes, comebacks, momentum shifts, raffle flips, instant regret…</small></label>
        <label><input type="checkbox" checked={prefs.deathWatch} onChange={e => update({ ...prefs, deathWatch: e.target.checked })} /> Death Watch <small>a new team on the chopping block, and every chop</small></label>
      </div>
      <p className="notify-subhead">Follow matchups <small>lead changes, new favorites and finals for these teams' games</small></p>
      <div className="notify-teams">
        {teams.map(t => <label key={t.id} className={prefs.teams.includes(t.id) ? "selected" : ""}>
          <input type="checkbox" checked={prefs.teams.includes(t.id)} onChange={() => toggleTeam(t.id)} />
          <TeamLogo src={t.logo} /><span>{t.name.trim()}</span>
        </label>)}
      </div>
      <div className="notify-actions">
        {subscription
          ? <>
              <button type="button" disabled={busy} onClick={() => run("Sending…", async () => { const r = await post("/test", { subscription: subscription.toJSON() }); return r.ok ? "Test sent — check your notifications." : `The push service returned ${r.status}.`; })}>Send a test</button>
              <button type="button" disabled={busy} className="secondary" onClick={turnOff}>Turn off</button>
            </>
          : <button type="button" disabled={busy} onClick={turnOn}>🔔 Turn on notifications</button>}
        {status ? <span className="notify-status">{status}</span> : null}
      </div>
    </>;
  }

  return (
    <details className="collapsible" id="notifications">
      <summary>🔔 Notifications <span>{subscription ? "ON" : "OFF"}</span></summary>
      <div className="notify-panel">{body}</div>
    </details>
  );
}
