// Notification service for the On Thursdays We Fantasy home-screen app.
//
// - fetch: phones sign up (/subscribe) with their Web Push subscription and
//   what they want to follow; /unsubscribe; /test sends a test alert;
//   /refresh starts the GitHub live-update workflow if the published data is
//   stale (pull-to-refresh in the app).
// - /live: the live data itself, published by each live update run (POST)
//   and polled by the app (GET); see live.js.
// - scheduled (every 2 minutes): reads the latest live data, finds
//   what's new since last time (lead changes, new favorites, finals, League
//   Wire highlights, Death Watch changes) and pushes it to matching phones.
//
// KV (SUBS): "vapid" (this service's own key pair, created on first use),
// "sub:<id>" (one per phone), "state" (what was already seen and sent),
// "refresh-requested" (when /refresh last started a workflow run).
// Secret GITHUB_TOKEN: a token allowed to run the repo's Actions workflows.
import { generateVapidKeys, sendPush } from "./webpush.js";
import { splashProbe, survivorFeed } from "./splash.js";
import { LiveStore, publishLive, readLive, serveLive } from "./live.js";
// Main-league team -> the same manager's guillotine team and Splash handles:
// following a team follows its manager's other contests too.
import managerLinks from "../../src/data/manager-links.json";

export { LiveStore };

const SITE = "https://boerkoel.github.io/OnThursdaysWeFantasy.io/";
const REPO = "boerkoel/OnThursdaysWeFantasy.io";
const ALLOWED_ORIGINS = ["https://boerkoel.github.io", "http://localhost:4173", "http://localhost:5173"];
// Only real browser push services may be stored as endpoints.
const PUSH_HOSTS = [/\.push\.apple\.com$/, /(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
const TEAM_ALERT_GAP_MS = 5 * 60 * 1000;
const SURVIVOR_SCARE = 0.4;     // a pick under this live win chance
const CHOP_ALERT_MOVE = 20;     // guillotine chop-odds move worth an alert (pts)
const WIN_SWING_ALERT = 30;     // matchup win-odds swing worth an alert (pts)
const MAX_ALERTS_PER_PHONE_PER_RUN = 3;
// /refresh starts a live update only when the published data is older than
// this, and at most once per gap (a run takes ~2 minutes to publish).
const REFRESH_STALE_MS = 5 * 60 * 1000;
const REFRESH_GAP_MS = 4 * 60 * 1000;
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
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const { pathname } = new URL(request.url);
    // CORS preflight: a 204 must not carry a body.
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    try {
      if (request.method === "GET" && pathname === "/vapid-public-key") {
        return json({ publicKey: (await vapidKeys(env)).publicKey }, 200, origin);
      }
      if (request.method === "GET" && pathname === "/health") return json({ ok: true }, 200, origin);
      if (request.method === "GET" && (pathname === "/live" || pathname === "/live/week-archive")) return serveLive(request, env, ctx, corsHeaders(origin));
      if (request.method === "POST" && pathname === "/live") {
        const { status, body } = await publishLive(request, env);
        return json(body, status, origin);
      }
      // Survivor contest (Splash): response shapes only, for building the feed.
      if (request.method === "GET" && pathname === "/splash/probe") return json(await splashProbe(env), 200, origin);
      // The Survivor tab's feed: standings and picks that have locked.
      if (request.method === "GET" && pathname === "/survivor") return json(await survivorFeed(env), 200, origin);
      if (request.method !== "POST") return json({ error: "Not found" }, 404, origin);
      if (pathname === "/refresh") return json(await requestLiveUpdate(env), 200, origin);

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

// The newest live data: the copy published to this service, or the one on
// GitHub Pages if that's newer (or the service has none).
async function latestLive(env) {
  const [mine, pages] = await Promise.all([
    readLive(env).catch(() => null),
    fetch(`${SITE}data/current/live.json?ts=${Date.now()}`, { cf: { cacheTtl: 0 } }).then(r => r.ok ? r.json() : null).catch(() => null)
  ]);
  const time = live => Date.parse(live?.scoreboard?.lastUpdated || "") || 0;
  return time(mine) >= time(pages) ? mine || pages : pages;
}

// ---- Pull-to-refresh -----------------------------------------------------------

// Starts update-live.yml (a manual run, which also takes over the chain of
// scheduled runs) unless the data is fresh or a run was just started.
// reason: "fresh" | "pending" | "started" | "unavailable".
async function requestLiveUpdate(env) {
  const lastUpdated = (await latestLive(env))?.scoreboard?.lastUpdated || null;
  const now = Date.now();
  if (lastUpdated && now - Date.parse(lastUpdated) < REFRESH_STALE_MS) return { started: false, reason: "fresh", lastUpdated };
  const requestedAt = Number(await env.SUBS.get("refresh-requested")) || 0;
  if (now - requestedAt < REFRESH_GAP_MS) return { started: false, reason: "pending", lastUpdated, requestedAt };
  if (!env.GITHUB_TOKEN) return { started: false, reason: "unavailable", lastUpdated };

  await env.SUBS.put("refresh-requested", String(now));
  const dispatch = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/update-live.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "otwf-notify",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ref: "main", inputs: { force_update: "true" } })
  });
  if (!dispatch.ok) {
    await env.SUBS.delete("refresh-requested");
    return { started: false, reason: "unavailable", lastUpdated, status: dispatch.status };
  }
  return { started: true, reason: "started", lastUpdated, requestedAt: now };
}

// ---- Finding what's new --------------------------------------------------------

export function findEvents(live, state) {   // exported for tests
  const events = [];
  const scoreboard = live.scoreboard || {};
  const week = Number(scoreboard.week);
  const next = {
    week,
    updated: [scoreboard.lastUpdated, live.marquee?.lastUpdated, live.guillotine?.lastUpdated].join("|"),
    leaders: {}, favorites: {}, finals: [],
    wireKeys: [],
    // Everything already alerted this week, so a story or chopping-block
    // leader that drops out for an update and comes back isn't sent again.
    sentWire: [], chopBlockSent: [],
    scoreboardUpdated: scoreboard.lastUpdated || null,
    chopLeader: null, chopped: [],
    guillotineWeek: Number(live.guillotine?.week),
    lastSent: state?.lastSent || {},
    // Manager alerts: what was last sent for each.
    svSent: [], chopAlerted: {}, winAlerted: {}
  };
  // A new week (or the very first run) only records a baseline.
  const baseline = !state || state.week !== week;
  const previous = baseline ? {} : state;
  next.sentWire = [...(previous.sentWire || [])];
  next.svSent = [...(previous.svSent || [])];
  next.chopAlerted = { ...(previous.chopAlerted || {}) };
  next.winAlerted = { ...(previous.winAlerted || {}) };
  next.chopBlockSent = [...(previous.chopBlockSent || [])];

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

    // A big swing in win odds since the last alert about it (lead changes and
    // new favorites have their own alerts).
    for (const [t, o] of [[a, b], [b, a]]) {
      const p = Number(t.winProbability);
      if (!Number.isFinite(p)) continue;
      const last = previous.winAlerted?.[t.teamId];
      if (last == null || baseline) { next.winAlerted[t.teamId] = p; continue; }
      if (!final && Math.abs(p - last) >= WIN_SWING_ALERT) {
        next.winAlerted[t.teamId] = p;
        events.push({ id: `swing-${t.teamId}-${scoreboard.lastUpdated}`, topics: [`team:${t.teamId}`], tag: `matchup-${matchupId}`,
          title: p > last ? "📈 Momentum" : "📉 Momentum", body: `${t.team} went from ${Math.round(last)}% to ${Math.round(p)}% to beat ${o.team} (${t.score.toFixed(2)}–${o.score.toFixed(2)}).` });
      }
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
    const alreadySent = (previous.wireKeys || []).includes(key) || next.sentWire.includes(key);
    if (!baseline && !alreadySent) {
      events.push({ id: `wire-${key}`, topics: ["wire"], tag: `wire-${story.type}`, title: "⚡ League Wire", body: story.text.replace(/^\S+\s/, "") });
    }
    if (!next.sentWire.includes(key)) next.sentWire.push(key);
  }
  next.sentWire = next.sentWire.slice(-400);

  // Death Watch: a new team on the chopping block, or a chop.
  const guillotine = live.guillotine || {};
  const sameGuillotineWeek = !baseline && state.guillotineWeek === next.guillotineWeek;
  const atRisk = (guillotine.teams || []).filter(t => t.chopProbability > 0).sort((x, y) => y.chopProbability - x.chopProbability);
  next.chopLeader = atRisk[0]?.teamId ?? null;
  next.chopped = (guillotine.teams || []).filter(t => t.chopProbability >= 100).map(t => t.teamId);
  if (!sameGuillotineWeek) next.chopBlockSent = [];
  if (sameGuillotineWeek && atRisk[0] && atRisk[0].chopProbability < 100 && state.chopLeader != null && state.chopLeader !== atRisk[0].teamId
    && !next.chopBlockSent.includes(atRisk[0].teamId)) {
    next.chopBlockSent.push(atRisk[0].teamId);
    events.push({ id: `chopblock-${guillotine.week}-${atRisk[0].teamId}-${guillotine.lastUpdated}`, topics: ["guillotine"], tag: "death-watch",
      title: "🪓 Death Watch", body: `${atRisk[0].team} is now on the chopping block (${Math.round(atRisk[0].chopProbability)}%).` });
  }
  for (const t of (guillotine.teams || []).filter(t => t.chopProbability >= 100)) {
    if (sameGuillotineWeek && !(state.chopped || []).includes(t.teamId)) {
      events.push({ id: `chopped-${guillotine.week}-${t.teamId}`, topics: ["guillotine"], tag: "death-watch", urgent: true,
        title: "🪓 Chopped", body: `${t.team} is out of ${guillotine.leagueName || "the guillotine league"} with ${Number(t.score).toFixed(2)} pts.` });
    }
  }
  managerEvents(live, week, baseline, previous, next, events);
  return { events, next };
}

// Alerts about a followed team's manager in their other contests: survivor
// entries (Splash) and their guillotine team. Sent to phones following the
// main-league team (topic team:<id>).
function managerEvents(live, week, baseline, previous, next, events) {
  const games = live.scoreboard?.nflGames || [];
  const feed = live.survivor;
  const FEED_ABBR = { WSH: "WAS", JAC: "JAX", LA: "LAR" };
  const gameOf = team => {
    for (const g of games) {
      const us = (g.teams || []).find(x => (FEED_ABBR[x.abbrev] || x.abbrev) === team), them = (g.teams || []).find(x => x !== us);
      if (us && them) return { g, us, them };
    }
    return null;
  };
  const svWeek = Number(feed?.contest?.currentWeek);
  for (const [teamId, link] of Object.entries(managerLinks)) {
    if (!link || typeof link !== "object") continue;
    const topics = [`team:${teamId}`];
    // Survivor: this week's revealed picks of this manager's entries, by team.
    const handles = new Set((link.splash || []).map(h => h.toLowerCase()));
    if (handles.size && feed && svWeek === week) {
      const mine = (feed.entries || []).filter(e => handles.has(String(e.user).toLowerCase()) && e.picks?.[svWeek]);
      const byTeam = new Map();
      for (const e of mine) byTeam.set(e.picks[svWeek].team, [...(byTeam.get(e.picks[svWeek].team) || []), e]);
      for (const [team, list] of byTeam) {
        const n = list.length, entries = n === 1 ? "entry" : "entries";
        // Splash marks a pick "lost" while its team trails: a result counts once the game is final.
        const gm0 = gameOf(team);
        const result = gm0 && !gm0.g.completed ? "pending" : list[0].picks[svWeek].result;
        const key = k => `${svWeek}|${teamId}|${team}|${k}`;
        if (result === "won" || result === "lost") {
          if (!next.svSent.includes(key(result))) {
            next.svSent.push(key(result));
            if (!baseline) {
              const alive = (feed.entries || []).filter(e => handles.has(String(e.user).toLowerCase()) && e.alive).length;
              events.push({ id: `sv-${key(result)}`, topics, tag: `survivor-${teamId}`, urgent: true,
                title: result === "won" ? "✅ Survivor" : "💀 Survivor",
                body: result === "won" ? `${team} won: ${n} ${entries} through Week ${svWeek} (${alive} alive).` : `${team} lost: ${n} ${entries} out (${alive} alive).` });
            }
          }
          continue;
        }
        const gm = gameOf(team);
        const w = gm?.us.winChance;
        if (gm && gm.g.state === "in" && w != null && w < SURVIVOR_SCARE && !next.svSent.includes(key("scare"))) {
          next.svSent.push(key("scare"));
          if (!baseline) events.push({ id: `sv-${key("scare")}`, topics, tag: `survivor-${teamId}`,
            title: "😬 Survivor scare", body: `${team} is down to ${Math.round(w * 100)}% to win (${gm.us.score}–${gm.them.score}, ${gm.g.detail}). ${n} ${entries} on the line.` });
        }
      }
    }
    // Guillotine: this manager's team's chop odds moving 20+ pts, or crossing 50%.
    const g = (live.guillotine?.teams || []).find(t => Number(t.teamId) === Number(link.guillotine));
    if (g && Number.isFinite(Number(g.chopProbability))) {
      const p = Number(g.chopProbability), k = `${live.guillotine.week}|${g.teamId}`;
      const last = previous.chopAlerted?.[k];
      if (last == null || baseline) next.chopAlerted[k] = p;
      else if (p < 100 && (Math.abs(p - last) >= CHOP_ALERT_MOVE || (p >= 50) !== (last >= 50))) {
        next.chopAlerted[k] = p;
        events.push({ id: `chop-${k}-${live.guillotine.lastUpdated}`, topics, tag: `guillotine-${g.teamId}`,
          title: p > last ? "🪓 Death Watch" : "😮‍💨 Death Watch",
          body: `${g.team}: chop odds ${Math.round(last)}% → ${Math.round(p)}%${p >= 50 ? ". On the chopping block." : p < last ? ". Breathing easier." : "."}` });
      }
    }
  }
  next.svSent = next.svSent.slice(-300);
  for (const k of Object.keys(next.chopAlerted)) if (!k.startsWith(`${live.guillotine?.week}|`)) delete next.chopAlerted[k];
}

function wants(prefs, topic) {
  if (topic === "wire") return prefs.wire;
  if (topic === "guillotine") return prefs.deathWatch;
  return (prefs.teams || []).includes(Number(topic.split(":")[1]));
}

async function checkForAlerts(env) {
  const live = await latestLive(env);
  if (!live) return;
  const state = await env.SUBS.get("state", "json");
  const updated = [live.scoreboard?.lastUpdated, live.marquee?.lastUpdated, live.guillotine?.lastUpdated].join("|");
  if (state && state.updated === updated) return; // nothing new published
  // An older snapshot republished (two deploys racing) would look like a
  // lot of "new" news, and then again when the newer data returns: skip it.
  if (state?.scoreboardUpdated && Date.parse(live.scoreboard?.lastUpdated) < Date.parse(state.scoreboardUpdated)) return;

  // Survivor picks for manager alerts (the feed is cached; a failure just skips them).
  live.survivor = await survivorFeed(env).catch(() => null);
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
