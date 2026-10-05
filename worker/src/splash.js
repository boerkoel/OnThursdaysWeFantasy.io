// Splash Sports session for the league's survivor contest (OnSundaysWeSurvive),
// whose standings and picks are visible only to entrants.
//
// The session is the commissioner's: a 1-hour access token plus a refresh
// token. Both are seeded once from the SPLASH_ACCESS_TOKEN / SPLASH_REFRESH_TOKEN
// worker secrets, then kept in KV ("splash-session") and renewed here, since
// each renewal can hand back a new refresh token.
export const CONTEST = "contest_01M3NEWY24GPHGZ5TYKSZ220S6";
const API = "https://api.splashsports.com/contests-service-v2/api";
const AUTH = "https://api.auth.splashsports.com";
// Splash's firewall (CloudFront) blocks requests that don't identify as a browser.
const APP_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  Accept: "application/json",
  Origin: "https://contests.app.splashsports.com",
  Referer: "https://contests.app.splashsports.com/",
  "x-app-platform": "web-v2",
  "x-app-version": "0.0.0",
  "splash-accept-version": "3"
};
const RENEW_BEFORE_MS = 5 * 60 * 1000;

// Access token expiry (JWT "exp"), or 0 if unreadable.
function expiresAt(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

// Which secrets a session grew from: when the secrets are set again, the
// stored session is dropped and the new ones take over.
async function seedId(env) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.SPLASH_REFRESH_TOKEN || ""));
  return [...new Uint8Array(digest)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function loadSession(env) {
  const seed = await seedId(env);
  const stored = await env.SUBS.get("splash-session", "json");
  if (stored?.accessToken && stored?.refreshToken && (!env.SPLASH_REFRESH_TOKEN || stored.seed === seed)) return stored;
  if (env.SPLASH_ACCESS_TOKEN && env.SPLASH_REFRESH_TOKEN) {
    // Developer Tools can show cookie values URL-encoded (%3D...): decode.
    const clean = v => { const t = v.trim(); try { return t.includes("%") ? decodeURIComponent(t) : t; } catch { return t; } };
    return { accessToken: clean(env.SPLASH_ACCESS_TOKEN), refreshToken: clean(env.SPLASH_REFRESH_TOKEN), seed, seeded: true };
  }
  return null;
}

// Renew the session; keeps whatever new tokens Splash returns.
async function renew(env, session) {
  const response = await fetch(`${AUTH}/universal-auth/refresh`, {
    method: "POST",
    headers: { ...APP_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken, accessToken: session.accessToken })
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  const data = body?.data || body || {};
  if (!response.ok || !data.accessToken) {
    // Enough to tell Splash's auth server from a firewall in front of it;
    // anything token-like is redacted.
    const snippet = text.slice(0, 160).replace(/[A-Za-z0-9_\-.]{24,}/g, "[…]");
    // The refresh token's shape (never its value) helps spot a bad copy.
    const shape = `refresh token: ${session.refreshToken.length} chars, ${session.refreshToken.split(".").length - 1} dots, seeded ${Boolean(session.seeded)}`;
    throw new Error(`Splash session renewal failed (${response.status}; ${response.headers.get("content-type") || "no type"}; server ${response.headers.get("server") || "?"}; ${snippet}; ${shape})`);
  }
  const next = { accessToken: data.accessToken, refreshToken: data.refreshToken || session.refreshToken, seed: session.seed, renewedAt: new Date().toISOString() };
  await env.SUBS.put("splash-session", JSON.stringify(next));
  return next;
}

async function freshSession(env) {
  let session = await loadSession(env);
  if (!session) throw new Error("No Splash session: set the SPLASH_ACCESS_TOKEN and SPLASH_REFRESH_TOKEN secrets.");
  if (expiresAt(session.accessToken) - Date.now() < RENEW_BEFORE_MS) session = await renew(env, session);
  else if (session.seeded) await env.SUBS.put("splash-session", JSON.stringify({ accessToken: session.accessToken, refreshToken: session.refreshToken, seed: session.seed }));
  return session;
}

// GET an entrant-only route; renews once and retries on 401.
export async function splashGet(env, path) {
  let session = await freshSession(env);
  const call = token => fetch(`${API}${path}`, { headers: { ...APP_HEADERS, Authorization: `Bearer ${token}` } });
  let response = await call(session.accessToken);
  if (response.status === 401) {
    session = await renew(env, session);
    response = await call(session.accessToken);
  }
  return { status: response.status, body: await response.json().catch(() => null) };
}

// ---- Probe ----------------------------------------------------------------------
// The SHAPE of each response only (field names, types, list sizes, lowercase
// status words): never names, teams or picks. Cached for 10 minutes.
// Status words are shown only under status-like keys (a lowercase string
// elsewhere could be a username).
const ENUM = /^[a-z][a-z_]{1,24}$/i;
const ENUM_KEY = /(status|result|state|type|view|outcome|role|sport|league)$/i;
function shape(value, depth = 0, key = "") {
  if (depth > 7) return "…";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length ? [`list(${value.length})`, shape(value[0], depth + 1, key)] : "list(0)";
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, depth + 1, k)]));
  if (typeof value === "string") return ENUM_KEY.test(key) && ENUM.test(value) ? `str:${value}` : `str(${value.length})`;
  return typeof value;
}

export async function splashProbe(env) {
  const cached = await env.SUBS.get("splash-probe", "json");
  if (cached && !cached.error && Date.now() - Date.parse(cached.at) < 10 * 60 * 1000) return cached;
  const result = { at: new Date().toISOString(), routes: {} };
  try {
    const contest = await splashGet(env, `/contests/${CONTEST}`);
    const c = contest.body?.data?.contest || {};
    result.viewer = { status: contest.status, role: c.viewerRole || null, isEntrant: Boolean(c.viewerContestUserId), myEntries: contest.body?.data?.entries?.user ?? null };
    result.routes["/contests"] = { status: contest.status, shape: shape(contest.body) };
    for (const route of [
      `/team-survivor/standings?contestId=${CONTEST}&limit=3`,
      `/team-survivor/statistics/overall?contestId=${CONTEST}`,
      `/team-survivor/availability/report?contestId=${CONTEST}`
    ]) {
      const { status, body } = await splashGet(env, route);
      result.routes[route.split("?")[0]] = status >= 400 ? { status, error: body?.error, message: body?.message } : { status, shape: shape(body) };
    }
    const session = await env.SUBS.get("splash-session", "json");
    result.session = { renewedAt: session?.renewedAt || null, accessExpires: session ? new Date(expiresAt(session.accessToken)).toISOString() : null };
  } catch (error) {
    result.error = String(error?.message || error);
  }
  await env.SUBS.put("splash-probe", JSON.stringify(result));
  return result;
}

// ---- Survivor feed (/survivor) ------------------------------------------------------
// The pool for the site's Survivor tab, rebuilt at most every 2 minutes.
// Picks are hidden until kickoff on Splash, but the commissioner's session
// can see them early: a pick is published only once it's graded or its game
// has started (ESPN), and never for a week that hasn't started.
//   { contest: { name, totalEntries, alive, eliminated, currentWeek, entryFee, prizePool, updatedAt },
//     weeks: [{ week, locked, final, hidden, picks: [{ team, count, result }] }],
//     entries: [{ id, user, entry, alive, eliminatedWeek, picks: { [week]: { team, result } } }] }
const FEED_MAX_AGE_MS = 2 * 60 * 1000;
const STANDINGS_PAGE = 100;
const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const alias = a => ({ WSH: "WAS", JAC: "JAX", LA: "LAR" }[String(a || "").toUpperCase()] || String(a || "").toUpperCase());
const gradeOf = g => (/^w/i.test(g || "") ? "won" : /^(l|t)/i.test(g || "") ? "lost" : "pending");
const weekOf = (slate, i) => Number(String(slate?.name || slate?.alias || "").match(/\d+/)?.[0]) || i + 4;

// Teams whose game this week has kicked off (or null if ESPN is unreachable).
async function startedTeams(week) {
  try {
    const response = await fetch(`${ESPN_SCOREBOARD}?seasontype=2&week=${week}&dates=${new Date().getUTCFullYear()}`);
    if (!response.ok) return null;
    const events = (await response.json()).events || [];
    const started = new Set();
    for (const event of events) {
      const competition = event.competitions?.[0];
      const state = competition?.status?.type?.state || event.status?.type?.state;
      if (state && state !== "pre") for (const c of competition?.competitors || []) started.add(alias(c.team?.abbreviation));
    }
    return started;
  } catch {
    return null;
  }
}

async function buildSurvivorFeed(env) {
  const contest = await splashGet(env, `/contests/${CONTEST}`);
  if (contest.status >= 400) throw new Error(`Splash contest ${contest.status}`);
  const rows = [];
  let slates = [];
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({ contestId: CONTEST, limit: String(STANDINGS_PAGE) });
    if (cursor) query.set("cursor", cursor);
    const { status, body } = await splashGet(env, `/team-survivor/standings?${query}`);
    if (status >= 400) throw new Error(`Splash standings ${status}`);
    rows.push(...(body?.data || []));
    if (body?.metadata?.slates?.length) slates = body.metadata.slates;
    cursor = body?.nextCursor;
    if (!cursor || !(body?.data || []).length) break;
  }

  const now = Date.now();
  const slateWeek = new Map(slates.map((s, i) => [s.slateId, weekOf(s, i)]));
  const startedSlates = slates.filter(s => Date.parse(s.startDate) <= now);
  const current = startedSlates[startedSlates.length - 1] || slates[0];
  const currentWeek = current ? slateWeek.get(current.slateId) : null;
  const isFinal = s => s && !/progress|upcoming|open|pending|scheduled|live/i.test(s.status || "");
  const kicked = current && !isFinal(current) ? await startedTeams(currentWeek) : null;

  const tally = new Map();
  const hidden = new Map();
  const entries = rows.map(row => {
    const picks = {};
    for (const s of row.slates || []) {
      const slate = slates.find(x => x.slateId === s.slateId);
      const week = slateWeek.get(s.slateId);
      if (!slate || !week || Date.parse(slate.startDate) > now) continue;
      for (const p of s.picks || []) {
        const team = alias(p.team?.alias);
        if (!team) continue;
        const result = gradeOf(p.grade || s.grade);
        const visible = result !== "pending" || isFinal(slate) || (slate === current && kicked?.has(team));
        if (!visible) { hidden.set(week, (hidden.get(week) || 0) + 1); continue; }
        picks[week] = { team, result };
        const key = `${week}:${team}`;
        const t = tally.get(key) || { week, team, count: 0, result };
        t.count++;
        if (result !== "pending") t.result = result;
        tally.set(key, t);
      }
    }
    const eliminatedWeek = row.eliminatedSlateId ? slateWeek.get(row.eliminatedSlateId) || null : null;
    return {
      id: row.entry?.id,
      user: row.user?.handle || "?",
      entry: row.entry?.order || 1,
      alive: !eliminatedWeek && !/elim|out|dead/i.test(row.entry?.status || ""),
      eliminatedWeek,
      picks
    };
  });

  const weeks = startedSlates.map(s => {
    const week = slateWeek.get(s.slateId);
    const picks = [...tally.values()].filter(t => t.week === week).map(({ team, count, result }) => ({ team, count, result }))
      .sort((a, b) => b.count - a.count);
    return { week, locked: picks.length > 0, final: isFinal(s), hidden: hidden.get(week) || 0, picks };
  });
  const next = slates.find(s => Date.parse(s.startDate) > now);
  if (next) weeks.push({ week: slateWeek.get(next.slateId), locked: false, final: false, hidden: 0, picks: [] });

  const c = contest.body?.data?.contest || {};
  const alive = entries.filter(e => e.alive).length;
  return {
    contest: { name: c.name || "Survivor", totalEntries: c.totalEntries || entries.length, alive, eliminated: entries.length - alive, currentWeek,
      entryFee: Number(c.entryFeeDollars) || null, prizePool: Number(c.prizePoolDollars) || null, updatedAt: new Date().toISOString() },
    weeks,
    entries
  };
}

export async function survivorFeed(env) {
  const cached = await env.SUBS.get("survivor-feed", "json");
  if (cached && Date.now() - Date.parse(cached.contest?.updatedAt) < FEED_MAX_AGE_MS) return cached;
  try {
    const feed = await buildSurvivorFeed(env);
    await env.SUBS.put("survivor-feed", JSON.stringify(feed));
    return feed;
  } catch (error) {
    // Splash or the session failing: keep serving the last good feed.
    if (cached) return { ...cached, stale: true };
    throw error;
  }
}
