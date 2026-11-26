// Usage counts (Jim, 2026-11-25: "see if anyone besides me is using this"). The site pings POST /hit when it
// opens and on each tab a visit reaches (src/lib/usage.js): a random id kept on that device, the tab, phone or
// desktop, home-screen app or browser. No names, no addresses. Devices marked as the commissioner's ("me") are
// counted apart, so the numbers are everyone else.
// - GET /usage: a small page with the last 4 weeks; GET /usage.json: the same as data.
// - Every morning at 8 AM Pacific, a push with yesterday's numbers to the "me" devices that have notifications on
//   (or, until one has, to phones following the commissioner's team).
// Kept in the LiveStore Durable Object (one key per day), never KV: KV's free plan allows 1,000 writes a day.
const DAY_KEY = day => `usage:${day}`;
const KEEP_DAYS = 90, REPORT_HOUR = 8;
export const usageDay = (t = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(t));
const dayBefore = (day, n = 1) => new Date(Date.parse(day + "T12:00:00Z") - n * 86400000).toISOString().slice(0, 10);

// A ping, as sent: { d: device id, tab, open: a new visit, me: true/false (marked or unmarked), app, mobile, push }.
export function cleanHit(body) {
  if (!/^[a-z0-9]{8,32}$/.test(body?.d || "")) return null;
  return {
    d: body.d,
    tab: /^[\w-]{1,24}$/.test(body.tab || "") ? body.tab : null,
    open: Boolean(body.open),
    me: typeof body.me === "boolean" ? body.me : null,
    kind: (body.mobile ? "phone" : "desktop") + (body.app ? " app" : ""),
    push: typeof body.push === "string" && body.push.startsWith("https://") && body.push.length < 1000 ? body.push : null
  };
}

// In the Durable Object: count one ping. day = { devices: { id: { opens, tabs: { tab: n }, kind } } };
// "usage:me" = { devices: { id: true }, subs: [push endpoints] }; "usage:seen" = { id: first day }.
export async function recordHit(storage, hit, now = Date.now()) {
  const day = usageDay(now);
  const [record, me, seen] = await Promise.all([storage.get(DAY_KEY(day)), storage.get("usage:me"), storage.get("usage:seen")]);
  const today = record || { devices: {} };
  const d = today.devices[hit.d] ||= { opens: 0, tabs: {}, kind: hit.kind };
  if (hit.open || !d.opens) d.opens++;
  if (hit.tab) d.tabs[hit.tab] = (d.tabs[hit.tab] || 0) + 1;
  const puts = { [DAY_KEY(day)]: today };
  const mine = me || { devices: {}, subs: [] };
  if (hit.me === true && (!mine.devices[hit.d] || (hit.push && !mine.subs.includes(hit.push)))) {
    mine.devices[hit.d] = true;
    if (hit.push && !mine.subs.includes(hit.push)) mine.subs = [...mine.subs, hit.push].slice(-6);
    puts["usage:me"] = mine;
  } else if (hit.me === false && mine.devices[hit.d]) {
    delete mine.devices[hit.d];
    puts["usage:me"] = mine;
  }
  if (!seen?.[hit.d]) puts["usage:seen"] = { ...(seen || {}), [hit.d]: day };
  await storage.put(puts);
  // Forget days past KEEP_DAYS (checked on the day's first ping).
  if (!record) await storage.delete(DAY_KEY(dayBefore(day, KEEP_DAYS)));
}

// The last `days` days, everyone but the "me" devices.
export async function usageSummary(storage, days = 28, now = Date.now()) {
  const today = usageDay(now);
  const list = Array.from({ length: days }, (_, i) => dayBefore(today, i));
  const [records, me, seen] = await Promise.all([storage.get(list.map(DAY_KEY)), storage.get("usage:me"), storage.get("usage:seen")]);
  const mine = me?.devices || {};
  const rows = list.map(day => {
    const devices = Object.entries(records.get(DAY_KEY(day))?.devices || {}).filter(([id]) => !mine[id]);
    const tabs = {}, kinds = {};
    for (const [, d] of devices) {
      for (const [t, n] of Object.entries(d.tabs)) tabs[t] = (tabs[t] || 0) + n;
      kinds[d.kind] = (kinds[d.kind] || 0) + 1;
    }
    return { day, people: devices.length, new: devices.filter(([id]) => seen?.[id] === day).length,
      opens: devices.reduce((n, [, d]) => n + d.opens, 0), tabs, kinds, ids: devices.map(([id]) => id) };
  });
  const unique = n => new Set(rows.slice(0, n).flatMap(r => r.ids)).size;
  return {
    generatedAt: new Date(now).toISOString(),
    last7: unique(7), last28: unique(28),
    meDevices: Object.keys(mine).length, reportTo: me?.subs?.length || 0,
    days: rows.map(({ ids, ...r }) => r)
  };
}

const shortDay = day => new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const topTabs = (tabs, n = 3) => Object.entries(tabs).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);

export function usagePage(s) {
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rows = s.days.map(r => `<tr><td>${shortDay(r.day)}</td><td>${r.people}</td><td>${r.new || ""}</td><td>${r.opens}</td><td>${esc(topTabs(r.tabs).join(", "))}</td><td>${esc(Object.entries(r.kinds).map(([k, n]) => `${n} ${k}`).join(", "))}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OTWF usage</title><style>
:root{color-scheme:light dark;font:15px/1.4 -apple-system,system-ui,sans-serif}body{margin:0 auto;max-width:720px;padding:16px}
h1{font-size:20px;margin:0 0 4px}p{margin:4px 0 14px;color:GrayText}.tiles{display:flex;gap:10px;margin-bottom:16px}
.tiles div{flex:1;border:1px solid #8884;border-radius:10px;padding:10px}.tiles b{display:block;font-size:26px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{text-align:left;padding:5px 6px;border-bottom:1px solid #8883}
th{font-weight:600}td:nth-child(n+2):nth-child(-n+4),th:nth-child(n+2):nth-child(-n+4){text-align:right}
</style></head><body><h1>Who's using the site</h1>
<p>Devices other than yours (${s.meDevices} marked as yours). Each device counts once a day.</p>
<div class="tiles"><div><b>${s.days[0]?.people ?? 0}</b>today</div><div><b>${s.last7}</b>last 7 days</div><div><b>${s.last28}</b>last 28 days</div></div>
<table><thead><tr><th>Day</th><th>People</th><th>New</th><th>Opens</th><th>Top tabs</th><th>Devices</th></tr></thead><tbody>${rows}</tbody></table>
<p>${s.reportTo ? "A summary goes to your phone at 8 AM." : "No phone marked as yours has notifications on yet, so the 8 AM summary goes to phones following your team."}</p>
</body></html>`;
}

// The 8 AM push: yesterday's numbers. Returns { title, body } or null if it's not time or already sent.
export function morningReport(summary, lastSent, now = Date.now()) {
  const hour = Number(new Date(now).toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hour12: false }));
  const today = usageDay(now);
  if (hour < REPORT_HOUR || lastSent === today) return null;
  const y = summary.days[1];
  if (!y) return null;
  const tabs = topTabs(y.tabs);
  return {
    day: today,
    title: `📊 Site usage, ${shortDay(y.day)}`,
    body: `${y.people} ${y.people === 1 ? "person" : "people"} besides you${y.new ? ` (${y.new} new)` : ""}, ${y.opens} ${y.opens === 1 ? "visit" : "visits"}`
      + (tabs.length ? `. Top: ${tabs.join(", ")}` : "") + `. Last 7 days: ${summary.last7}.`
  };
}
