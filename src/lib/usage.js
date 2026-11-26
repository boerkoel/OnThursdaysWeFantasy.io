// Usage counts (Jim, 2026-11-25: "see if anyone besides me is using this"; worker/src/usage.js). An anonymous ping
// to the notify service when the site opens (or comes back after 30+ minutes away) and on each tab a visit reaches:
// a random id kept on this device, the tab, phone or desktop, home-screen app or browser. Nothing else.
// The commissioner's devices count apart: ?me=1 in the address marks one (?me=0 unmarks), or tap the title 5 times.
import { NOTIFY_SERVICE } from "./data.js";

const ID_KEY = "otwfDevice", ME_KEY = "otwfMe", AWAY_MS = 30 * 60 * 1000;
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
};
function deviceId() {
  let id = store.get(ID_KEY);
  if (!/^[a-z0-9]{8,32}$/.test(id || "")) { id = Array.from(crypto.getRandomValues(new Uint8Array(10)), b => (b % 36).toString(36)).join(""); store.set(ID_KEY, id); }
  return id;
}
try {
  const me = new URLSearchParams(window.location.search).get("me");
  if (me === "1" || me === "0") store.set(ME_KEY, me);
} catch {}
export const isMe = () => store.get(ME_KEY) === "1";

let lastSeen = 0;
const seenTabs = new Set();
async function send(body) {
  if (!navigator.onLine || /localhost|127\.0\.0\.1/.test(window.location.hostname)) return;
  const me = store.get(ME_KEY);
  // A marked device sends its push address too, so the morning summary reaches it.
  const push = me === "1" ? await navigator.serviceWorker?.getRegistration().then(r => r?.pushManager.getSubscription()).then(s => s?.endpoint || null).catch(() => null) : null;
  const app = Boolean(window.navigator.standalone || window.matchMedia?.("(display-mode: standalone)").matches);
  const mobile = window.matchMedia?.("(pointer: coarse)").matches && Math.min(window.screen.width, window.screen.height) < 600;
  fetch(`${NOTIFY_SERVICE}/hit`, { method: "POST", keepalive: true, headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ d: deviceId(), ...body, me: me === "1" ? true : me === "0" ? false : undefined, app, mobile, push }) }).catch(() => {});
}

// Called with the tab on every tab change: a new visit counts an open; each tab once per visit.
export function pingTab(tab) {
  const now = Date.now(), open = now - lastSeen > AWAY_MS;
  if (open) seenTabs.clear();
  lastSeen = now;
  if (!open && seenTabs.has(tab)) return;
  seenTabs.add(tab);
  send({ tab, open });
}
// Back after 30+ minutes away (the home-screen app stays open in the background): a new visit.
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") lastSeen = Date.now();
  else if (Date.now() - lastSeen > AWAY_MS && seenTabs.size) pingTab([...seenTabs].at(-1));
});

// Five taps on the title within 3 seconds marks (or unmarks) this device as the commissioner's.
let taps = [];
export function titleTap() {
  const now = Date.now();
  taps = [...taps.filter(t => now - t < 3000), now];
  if (taps.length < 5) return null;
  taps = [];
  const on = !isMe();
  store.set(ME_KEY, on ? "1" : "0");
  send({ tab: null, open: false });
  return on;
}
