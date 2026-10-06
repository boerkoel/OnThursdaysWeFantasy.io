// Live data, published straight from the live update runs instead of
// rebuilding and redeploying GitHub Pages every couple of minutes.
//
// POST /live (Bearer LIVE_PUBLISH_TOKEN) with each live file as JSON text:
//   { scoreboardUpdated, files: { scoreboard, marquee, livePlays, guillotine, seasonOdds, weekArchive } }
// (text, so the worker passes it through without parsing 400 KB).
// GET  /live              -> live.json's shape (what the page polls)
// GET  /live/week-archive -> the week archive (League tab recap charts)
//
// The files live in one Durable Object (LiveStore), kept in memory and in its
// storage. A Durable Object rather than KV: its free allowance covers a write
// every update and a read on every page poll; KV's daily write cap wouldn't.
// Files are kept as text so serving them doesn't re-parse anything.
const LIVE_FILES = ["scoreboard", "marquee", "livePlays", "guillotine", "seasonOdds"];
const ALL_FILES = [...LIVE_FILES, "weekArchive"];
const EDGE_CACHE_SECONDS = 5;

export class LiveStore {
  constructor(state) {
    this.state = state;
    this.files = null;
  }
  async load() {
    if (!this.files) this.files = Object.fromEntries(await this.state.storage.get(ALL_FILES.concat("meta")));
    return this.files;
  }
  async fetch(request) {
    const files = await this.load();
    if (request.method === "PUT") {
      const { scoreboardUpdated, files: incoming = {} } = await request.json();
      // Two runs racing: never let an older scoreboard replace a newer one.
      const updated = Date.parse(scoreboardUpdated || "");
      const current = Date.parse(files.meta?.scoreboardUpdated || "");
      if (!Number.isFinite(updated)) return Response.json({ stored: false, reason: "no scoreboardUpdated" });
      if (Number.isFinite(current) && updated < current) return Response.json({ stored: false, reason: "older" });
      const next = { meta: { scoreboardUpdated: new Date(updated).toISOString(), publishedAt: new Date().toISOString() } };
      for (const name of ALL_FILES) if (typeof incoming[name] === "string") next[name] = incoming[name];
      await this.state.storage.put(next);
      Object.assign(files, next);
      return Response.json({ stored: true, ...next.meta });
    }
    const url = new URL(request.url);
    if (url.pathname.endsWith("/week-archive")) return new Response(files.weekArchive || "null", { headers: { "Content-Type": "application/json" } });
    if (!files.scoreboard) return new Response("null", { headers: { "Content-Type": "application/json" } });
    const body = "{" + LIVE_FILES.filter(n => files[n]).map(n => JSON.stringify(n) + ":" + files[n])
      .concat(`"publishedAt":${JSON.stringify(files.meta?.publishedAt || null)}`).join(",") + "}";
    return new Response(body, { headers: { "Content-Type": "application/json" } });
  }
}

const store = env => env.LIVE.get(env.LIVE.idFromName("live"));

// The live files' text, for the worker's own use (alerts, refresh checks);
// null when nothing has been published yet.
export async function readLive(env) {
  if (!env.LIVE) return null;
  const response = await store(env).fetch("https://live/live");
  const text = await response.text();
  return text === "null" ? null : JSON.parse(text);
}

export async function publishLive(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!env.LIVE_PUBLISH_TOKEN || auth !== `Bearer ${env.LIVE_PUBLISH_TOKEN}`) return { status: 401, body: { error: "Unauthorized" } };
  if (!env.LIVE) return { status: 503, body: { error: "No live store" } };
  const response = await store(env).fetch("https://live/live", { method: "PUT", body: request.body, headers: { "Content-Type": "application/json" } });
  return { status: 200, body: await response.json() };
}

// GET /live and /live/week-archive, cached briefly at the edge so a crowd of
// phones polling every 15 seconds doesn't mean a Durable Object hit each.
export async function serveLive(request, env, ctx, headers) {
  const cache = caches.default;
  const key = new Request(new URL(new URL(request.url).pathname, request.url).toString());
  let response = await cache.match(key);
  if (!response) {
    const stored = await store(env).fetch(new URL(new URL(request.url).pathname, "https://live").toString());
    response = new Response(stored.body, { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${EDGE_CACHE_SECONDS}` } });
    ctx.waitUntil(cache.put(key, response.clone()));
  }
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}
