// Notification service for the On Thursdays We Fantasy home-screen app.
//
// - fetch: phones sign up (/subscribe) with their Web Push subscription and
//   what they want to follow; /unsubscribe; /test sends a test alert.
// - scheduled (every 2 minutes): reads the site's published live.json, finds
//   what's new since last time (lead changes, new favorites, finals, League
//   Wire highlights, Death Watch changes) and pushes it to matching phones.
//
// KV (SUBS): "vapid" (this service's own key pair, created on first use),
// "sub:<id>" (one per phone), "state" (what was already seen and sent).
import { generateVapidKeys, sendPush } from "./webpush.js";

const SITE = "https://boerkoel.github.io/OnThursdaysWeFantasy.io/";
const ALLOWED_ORIGINS = ["https://boerkoel.github.io", "http://localhost:4173", "http://localhost:5173"];
// Only real browser push services may be stored as endpoints.
const PUSH_HOSTS = [/\.push\.apple\.com$/, /(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
const TEAM_ALERT_GAP_MS = 5 * 60 * 1000;
const MAX_ALERTS_PER_PHONE_PER_RUN = 3;
const WIRE_HIGHLIGHTS = new Set(["MATCHUP FLIP", "PROJECTION FLIP", "MEDIAN FLIP", "ALL EYES ON", "INSTANT REGRET", "COMEBACK",
  "HEART ATTACK GAME", "MOMENTUM SHIFT", "RAFFLE FLIP", "HOT PICKUP"]);

const corsHeaders = origin => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin"
});
const json = (data, status, origin) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
});

async function subscriptionId(endpoint) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(hash)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function vapidKeys(env) {
  let vapid = await env.SUBS.get("vapid", "json");
  if (!vapid) {
    vapid = await generateVapidKeys();
    await env.SUBS.put("vapid", JSON.stringify(vapid));
  }
  return vapid;
}

function validSubscription(subscription) {
  try {
    const url = new URL(subscription.endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some(host => host.test(url.hostname)) &&
      typeof subscription.keys?.p256dh === "string" && typeof subscription.keys?.auth === "string";
  } catch {
    return false;
  }
}

function cleanPrefs(prefs = {}) {
  return {
    wire: Boolean(prefs.wire),
    deathWatch: Boolean(prefs.deathWatch),
    teams: [...new Set((prefs.teams || []).map(Number).filter(Number.isFinite))].slice(0, 12)
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const { pathname } = new URL(request.url);
    // CORS preflight: a 204 must not carry a body.
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    try {
      if (request.method === "GET" && pathname === "/vapid-public-key") {
        return json({ publicKey: (await vapidKeys(env)).publicKey }, 200, origin);
      }
      if (request.method === "GET" && pathname === "/health") return json({ ok: true }, 200, origin);
      if (request.method !== "POST") return json({ error: "Not found" }, 404, origin);

      const body = await request.json().catch(() => ({}));
      const subscription = body.subscription || {};
      if (!validSubscription(subscription)) return json({ error: "Invalid subscription" }, 400, origin);
      const id = await subscriptionId(subscription.endpoint);

      if (pathname === "/subscribe") {
        const prefs = cleanPrefs(body.prefs);
        await env.SUBS.put(`sub:${id}`, JSON.stringify({ subscription, prefs, updatedAt: new Date().toISOString() }));
        return json({ ok: true, prefs }, 200, origin);
      }
      if (pathname === "/unsubscribe") {
        await env.SUBS.delete(`sub:${id}`);
        return json({ ok: true }, 200, origin);
      }
      if (pathname === "/test") {
        const stored = await env.SUBS.get(`sub:${id}`, "json");
        if (!stored) return json({ error: "Not subscribed" }, 404, origin);
        const status = await sendPush(stored.subscription, {
          title: "🏈 Notifications are on",
          body: "You'll get alerts for what you follow. On Thursdays We Fantasy.",
          url: SITE, tag: "test"
        }, await vapidKeys(env), SITE);
        return json({ ok: status < 300, status }, 200, origin);
      }
      return json({ error: "Not found" }, 404, origin);
    } catch (error) {
      return json({ error: String(error?.message || error) }, 500, origin);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkForAlerts(env));
  }
};

// ---- Finding what's new --------------------------------------------------------

function findEvents(live, state) {
  const events = [];
  const scoreboard = live.scoreboard || {};
  const week = Number(scoreboard.week);
  const next = {
    week,
    updated: [scoreboard.lastUpdated, live.marquee?.lastUpdated, live.guillotine?.lastUpdated].join("|"),
    leaders: {}, favorites: {}, finals: [],
    wireKeys: [],
    chopLeader: null, chopped: [],
    guillotineWeek: Number(live.guillotine?.week),
    lastSent: state?.lastSent || {}
  };
  // A new week (or the very first run) only records a baseline.
  const baseline = !state || state.week !== week;
  const previous = baseline ? {} : state;

  const byMatchup = new Map();
  for (const s of scoreboard.scores || []) {
    if (!byMatchup.has(s.matchupId)) byMatchup.set(s.matchupId, []);
    byMatchup.get(s.matchupId).push(s);
  }
  for (const [matchupId, pair] of byMatchup) {
    if (pair.length !== 2) continue;
    const [a, b] = pair;
    const topics = [`team:${a.teamId}`, `team:${b.teamId}`];
    const tag = `matchup-${matchupId}`;
    const final = a.startersLeft === 0 && b.startersLeft === 0;

    const leader = a.score > b.score ? a : b.score > a.score ? b : null;
    next.leaders[matchupId] = leader?.teamId ?? previous.leaders?.[matchupId] ?? null;
    if (leader && a.score > 0 && b.score > 0 && previous.leaders?.[matchupId] != null && previous.leaders[matchupId] !== leader.teamId && !final) {
      const other = leader === a ? b : a;
      events.push({ id: `lead-${matchupId}-${leader.teamId}-${scoreboard.lastUpdated}`, topics, tag,
        title: "🔄 Lead change", body: `${leader.team} now leads ${other.team} ${leader.score.toFixed(2)}–${other.score.toFixed(2)}.` });
    }

    // New favorite, with a buffer so small wobbles around 50% don't alert.
    const oddsA = Number(a.winProbability);
    const favorite = oddsA > 55 ? a.teamId : oddsA < 45 ? b.teamId : previous.favorites?.[matchupId] ?? null;
    next.favorites[matchupId] = favorite;
    if (!final && favorite != null && previous.favorites?.[matchupId] != null && previous.favorites[matchupId] !== favorite) {
      const fav = favorite === a.teamId ? a : b;
      const other = fav === a ? b : a;
      events.push({ id: `fav-${matchupId}-${favorite}-${scoreboard.lastUpdated}`, topics, tag,
        title: "📈 New favorite", body: `${fav.team} is now ${Math.round(fav.winProbability)}% to beat ${other.team}.` });
    }

    if (final) next.finals.push(matchupId);
    if (final && !baseline && !(previous.finals || []).includes(matchupId)) {
      const [winner, loser] = a.score >= b.score ? [a, b] : [b, a];
      events.push({ id: `final-${week}-${matchupId}`, topics, tag, urgent: true,
        title: "🏁 Final", body: `${winner.team} ${winner.score === loser.score ? "ties" : "beats"} ${loser.team} ${winner.score.toFixed(2)}–${loser.score.toFixed(2)}.` });
    }
  }

  // League Wire highlights. Numbers are stripped from the key so a story whose
  // odds tick up doesn't count as new.
  const stories = Number(live.marquee?.week) === week ? live.marquee.stories || [] : [];
  for (const story of stories) {
    if (!WIRE_HIGHLIGHTS.has(story.type)) continue;
    const key = story.type + "|" + String(story.text).replace(/[\d.,%–-]+/g, "#");
    next.wireKeys.push(key);
    if (!baseline && !(previous.wireKeys || []).includes(key)) {
      events.push({ id: `wire-${key}`, topics: ["wire"], tag: `wire-${story.type}`, title: "⚡ League Wire", body: story.text.replace(/^\S+\s/, "") });
    }
  }

  // Death Watch: a new team on the chopping block, or a chop.
  const guillotine = live.guillotine || {};
  const sameGuillotineWeek = !baseline && state.guillotineWeek === next.guillotineWeek;
  const atRisk = (guillotine.teams || []).filter(t => t.chopProbability > 0).sort((x, y) => y.chopProbability - x.chopProbability);
  next.chopLeader = atRisk[0]?.teamId ?? null;
  next.chopped = (guillotine.teams || []).filter(t => t.chopProbability >= 100).map(t => t.teamId);
  if (sameGuillotineWeek && atRisk[0] && atRisk[0].chopProbability < 100 && state.chopLeader != null && state.chopLeader !== atRisk[0].teamId) {
    events.push({ id: `chopblock-${guillotine.week}-${atRisk[0].teamId}-${guillotine.lastUpdated}`, topics: ["guillotine"], tag: "death-watch",
      title: "🪓 Death Watch", body: `${atRisk[0].team} is now on the chopping block (${Math.round(atRisk[0].chopProbability)}%).` });
  }
  for (const t of (guillotine.teams || []).filter(t => t.chopProbability >= 100)) {
    if (sameGuillotineWeek && !(state.chopped || []).includes(t.teamId)) {
      events.push({ id: `chopped-${guillotine.week}-${t.teamId}`, topics: ["guillotine"], tag: "death-watch", urgent: true,
        title: "🪓 Chopped", body: `${t.team} is out of ${guillotine.leagueName || "the guillotine league"} with ${Number(t.score).toFixed(2)} pts.` });
    }
  }
  return { events, next };
}

function wants(prefs, topic) {
  if (topic === "wire") return prefs.wire;
  if (topic === "guillotine") return prefs.deathWatch;
  return (prefs.teams || []).includes(Number(topic.split(":")[1]));
}

async function checkForAlerts(env) {
  const response = await fetch(`${SITE}data/current/live.json?ts=${Date.now()}`, { cf: { cacheTtl: 0 } });
  if (!response.ok) return;
  const live = await response.json();
  const state = await env.SUBS.get("state", "json");
  const updated = [live.scoreboard?.lastUpdated, live.marquee?.lastUpdated, live.guillotine?.lastUpdated].join("|");
  if (state && state.updated === updated) return; // nothing new published

  const { events, next } = findEvents(live, state);
  if (events.length) {
    const vapid = await vapidKeys(env);
    const now = Date.now();
    const keys = (await env.SUBS.list({ prefix: "sub:" })).keys;
    for (const { name } of keys) {
      const stored = await env.SUBS.get(name, "json");
      if (!stored) continue;
      let sent = 0;
      for (const event of events) {
        if (sent >= MAX_ALERTS_PER_PHONE_PER_RUN) break;
        const topic = event.topics.find(t => wants(stored.prefs, t));
        if (!topic) continue;
        const gapKey = `${name}|${topic}`;
        if (!event.urgent && topic.startsWith("team:") && now - (next.lastSent[gapKey] || 0) < TEAM_ALERT_GAP_MS) continue;
        const status = await sendPush(stored.subscription, { title: event.title, body: event.body, url: SITE, tag: event.tag }, vapid, SITE).catch(() => 0);
        if (status === 404 || status === 410) { await env.SUBS.delete(name); break; }
        if (status >= 200 && status < 300) { next.lastSent[gapKey] = now; sent++; }
      }
    }
    // Forget rate-limit entries older than a day.
    for (const [key, time] of Object.entries(next.lastSent)) if (now - time > 86400000) delete next.lastSent[key];
  }
  await env.SUBS.put("state", JSON.stringify(next));
}
