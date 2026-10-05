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

async function loadSession(env) {
  const stored = await env.SUBS.get("splash-session", "json");
  if (stored?.accessToken && stored?.refreshToken) return stored;
  if (env.SPLASH_ACCESS_TOKEN && env.SPLASH_REFRESH_TOKEN) {
    // Developer Tools can show cookie values URL-encoded (%3D...): decode.
    const clean = v => { const t = v.trim(); try { return t.includes("%") ? decodeURIComponent(t) : t; } catch { return t; } };
    return { accessToken: clean(env.SPLASH_ACCESS_TOKEN), refreshToken: clean(env.SPLASH_REFRESH_TOKEN), seeded: true };
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
  const next = { accessToken: data.accessToken, refreshToken: data.refreshToken || session.refreshToken, renewedAt: new Date().toISOString() };
  await env.SUBS.put("splash-session", JSON.stringify(next));
  return next;
}

async function freshSession(env) {
  let session = await loadSession(env);
  if (!session) throw new Error("No Splash session: set the SPLASH_ACCESS_TOKEN and SPLASH_REFRESH_TOKEN secrets.");
  if (expiresAt(session.accessToken) - Date.now() < RENEW_BEFORE_MS) session = await renew(env, session);
  else if (session.seeded) await env.SUBS.put("splash-session", JSON.stringify({ accessToken: session.accessToken, refreshToken: session.refreshToken }));
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
const ENUM = /^[a-z][a-z_]{1,24}$/;
function shape(value, depth = 0) {
  if (depth > 6) return "…";
  if (Array.isArray(value)) return value.length ? [`list(${value.length})`, shape(value[0], depth + 1)] : "list(0)";
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, depth + 1)]));
  if (typeof value === "string") return ENUM.test(value) ? `str:${value}` : `str(${value.length})`;
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
    for (const route of [
      `/team-survivor/standings/summary?contestId=${CONTEST}`,
      `/team-survivor/standings?contestId=${CONTEST}&limit=5&offset=0`,
      `/team-survivor/statistics/overall?contestId=${CONTEST}`,
      `/team-survivor/availability?contestId=${CONTEST}&limit=5`
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
