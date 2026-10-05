// One-time probe of the Splash Sports survivor API (run by
// .github/workflows/splash-probe.yml). Prints only the SHAPE of each
// response (field names, types, list sizes, lowercase status words), never
// names, teams or picks: Actions logs in this repo are public.
const CONTEST = "contest_01M3NEWY24GPHGZ5TYKSZ220S6";
const BASE = "https://api.splashsports.com/contests-service-v2/api";
const token = process.env.SPLASH_ACCESS_TOKEN;
if (!token) throw new Error("SPLASH_ACCESS_TOKEN missing");

// Access token lifetime (JWT "exp"), without printing the token.
try {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  console.log("access token expires:", payload.exp ? new Date(payload.exp * 1000).toISOString() : "(no exp)", "| issued:", payload.iat ? new Date(payload.iat * 1000).toISOString() : "?");
} catch { console.log("access token is not a JWT"); }

const ENUM = /^[a-z][a-z_]{1,24}$/;
function shape(value, depth = 0, seen = { lists: 0 }) {
  if (depth > 5) return "…";
  if (Array.isArray(value)) return value.length ? [`list(${value.length})`, shape(value[0], depth + 1, seen)] : "list(0)";
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, depth + 1, seen)]));
  if (typeof value === "string") return ENUM.test(value) ? `str:${value}` : `str(${value.length})`;
  return typeof value;
}
async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${token}`, Origin: "https://contests.app.splashsports.com", Referer: "https://contests.app.splashsports.com/", "x-app-platform": "web-v2", "x-app-version": "0.0.0" } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
// Who Splash thinks we are in this contest (role and entry count only).
{
  const { status, body } = await get(`/contests/${CONTEST}`);
  const c = body?.data?.contest || {};
  console.log(`contest as viewer [${status}]: viewerRole=${c.viewerRole} hasContestUserId=${Boolean(c.viewerContestUserId)} myEntries=${body?.data?.entries?.user}`);
}
const probes = [
  `/team-survivor/standings/summary?contestId=${CONTEST}`,
  `/team-survivor/standings?contestId=${CONTEST}&limit=5&offset=0`,
  `/team-survivor/statistics/overall?contestId=${CONTEST}`,
  `/team-survivor/availability?contestId=${CONTEST}&limit=5`
];
for (const p of probes) {
  const { status, body } = await get(p);
  console.log(`\n=== ${p.split("?")[0]} [${status}]`);
  if (status >= 400) { console.log("error:", body?.error, "-", body?.message); continue; }
  console.log(JSON.stringify(shape(body), null, 1).slice(0, 6000));
}
