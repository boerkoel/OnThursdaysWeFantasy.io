import { readFile, writeFile } from "node:fs/promises";

// Breaking NFL news about players, for the League Wire's NEWS story. ESPN's
// public news feed tags each article with athletes (same ids as fantasy
// players); only breaking headlines (HeadlineNews) are kept, and only the
// players named in the headline itself (the tags are noisy). Writes
// data/current/news.json.
const OUT = process.env.NEWS_PATH || "data/current/news.json";
const KEEP_MS = 48 * 60 * 60 * 1000;
const response = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=100", {
  headers: { Accept: "application/json", "User-Agent": "OnThursdaysWeFantasy/1.0" }
});
if (!response.ok) throw new Error(`ESPN news: ${response.status}`);
const { articles = [] } = await response.json();
const surname = name => String(name).replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, "").split(" ").slice(-1)[0];
const items = articles
  .filter(a => a.type === "HeadlineNews" && Date.now() - Date.parse(a.published) <= KEEP_MS)
  .map(a => ({
    headline: a.headline,
    published: a.published,
    players: (a.categories || []).filter(c => c.type === "athlete" && c.athleteId && c.description)
      .filter(c => a.headline.toLowerCase().includes(surname(c.description).toLowerCase()))
      .map(c => ({ id: Number(c.athleteId), name: c.description }))
  }))
  .filter(a => a.players.length);
// NFL insiders on Bluesky (free public API; X's isn't): Ian Rapoport posts
// there actively. Schefter's account is quiet (his reports reach ESPN's feed
// above), but costs nothing to check. A post counts when it names a player
// rostered in the league (by full name); its first sentence is the headline.
const INSIDERS = [["rapsheet.bsky.social", "Ian Rapoport"], ["adamschefter.bsky.social", "Adam Schefter"]];
const roster = JSON.parse(await readFile("data/current/mRoster.json", "utf8").catch(() => "{}"));
const players = new Map();
for (const t of roster.teams || []) for (const e of t.roster?.entries || []) {
  const p = e.playerPoolEntry?.player;
  if (p?.fullName && Number(e.playerId) > 0) players.set(Number(e.playerId), p.fullName);
}
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const matchers = [...players].map(([id, full]) => ({ id, name: full, re: new RegExp("\\b" + escape(full) + "\\b") }));
const STATUS = /\b(out|ruled|inactive|questionable|doubtful|probable|expected to (?:play|start|return)|unlikely|will (?:play|start|miss|return)|IR|injured reserve|activated|active roster|return|practice|limited|surgery|torn|tear|sprain|strain|concussion|suspend|traded|trade|released|waived|signed|benched|start)\b/i;
let insiderCount = 0;
for (const [handle, source] of INSIDERS) {
  try {
    const feed = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${handle}&limit=50&filter=posts_no_replies`,
      { headers: { Accept: "application/json", "User-Agent": "OnThursdaysWeFantasy/1.0" }, signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null);
    for (const f of feed?.feed || []) {
      if (f.reason) continue;   // reposts
      const rec = f.post?.record || {};
      const text = String(rec.text || "").replace(/\s+/g, " ").trim();
      if (!text || Date.now() - Date.parse(rec.createdAt) > KEEP_MS) continue;
      const named = matchers.filter(m => m.re.test(text)).map(({ id, name }) => ({ id, name }));
      if (!named.length) continue;
      // The sentence (or list item) that names the player; "vs." and the like don't end a sentence.
      const parts = text.split(/(?<!\b(?:vs|Jr|Sr|St|No)\.)(?<=[.!?])\s+|\s+—\s+|^—\s+/).map(x => x.replace(/^[—–-]\s*/, "").trim()).filter(Boolean);
      const sentence = parts.find(x => named.some(n => x.includes(n.name))) || parts[0] || text;
      const clean = sentence.replace(/^Significant transactions:\s*/i, "");
      // Only players the news is about: a status word after the name, in the same sentence
      // (not "…told to leave a meeting by QB Patrick Mahomes").
      const about = named.filter(n => clean.includes(n.name) && STATUS.test(clean.slice(clean.indexOf(n.name) + n.name.length)));
      if (!about.length) continue;
      items.push({ headline: clean.length > 150 ? clean.slice(0, 147).replace(/\s+\S*$/, "") + "…" : clean, published: rec.createdAt, source, players: about });
      insiderCount++;
    }
  } catch (error) {
    console.warn(`News: ${source} on Bluesky skipped: ${error.message}`);
  }
}

// ESPN re-publishes updated articles: one item per headline, the newest.
const seenHeadlines = new Set();
const unique = items.sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
  .filter(i => { const k = i.headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); return !seenHeadlines.has(k) && seenHeadlines.add(k); });
items.length = 0;
items.push(...unique);
await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2) + "\n");
console.log(`News: ${items.length} player headlines in the last 48 hours (${insiderCount} from insiders on Bluesky).`);

// Ruled out mid-game (Jim, 2026-11-15): a fresh headline or insider post saying a player in a game in progress is
// ruled out / won't return goes into live-plays.json's injuries as "out", so the next live run's odds drop his
// remaining points (simulation.js injuryShareFn) even before ESPN's play-by-play says so. Main league and guillotine.
const RULED_OUT = /\b(ruled out|won't return|will not return|out for the (?:rest of the )?(?:game|day|night)|done for the (?:day|night|game))\b/i;
const FRESH_MS = 3 * 60 * 60 * 1000;
try {
  const livePath = "data/current/live-plays.json";
  const live = JSON.parse(await readFile(livePath, "utf8"));
  const board = JSON.parse(await readFile("data/current/scoreboard.json", "utf8"));
  const guillotine = JSON.parse(await readFile("data/current/guillotine.json", "utf8").catch(() => "null"));
  const playing = new Map((board.nflGames || []).filter(g => g.state === "in").flatMap(g => (g.teamIds || []).map(id => [Number(id), g])));
  // who rosters whom: main league from mRoster, guillotine from its lineups
  const owners = [];
  for (const t of roster.teams || []) for (const e of t.roster?.entries || []) {
    const p = e.playerPoolEntry?.player;
    if (p) owners.push({ id: Number(e.playerId), name: p.fullName, proTeamId: Number(p.proTeamId), league: "main", teamId: Number(t.id) });
  }
  if (Number(guillotine?.week) === Number(live.week)) for (const t of guillotine.teams || []) for (const p of t.lineup || [])
    owners.push({ id: Number(p.id), name: null, proTeamId: Number(p.proTeamId), league: "guillotine", teamId: Number(t.teamId) });
  const added = [];
  for (const item of items) {
    if (!RULED_OUT.test(item.headline) || Date.now() - Date.parse(item.published) > FRESH_MS) continue;
    for (const pl of item.players) {
      for (const o of owners.filter(o => o.id === Number(pl.id))) {
        const game = playing.get(o.proTeamId);
        if (!game || Date.parse(item.published) < Date.parse(game.kickoff)) continue;
        const id = `news-${o.id}-${o.league}-${Date.parse(item.published)}`;
        if ((live.injuries || []).some(i => i.id === id)) continue;
        added.push({ id, source: "news", eventId: String(game.id), status: "out", text: item.headline, playerId: o.id, player: pl.name,
          league: o.league, teamId: o.teamId, matchupId: null, wallclock: item.published });
      }
    }
  }
  if (added.length) {
    live.injuries = [...added, ...(live.injuries || [])];
    await writeFile(livePath, JSON.stringify(live, null, 2) + "\n");
    console.log(`News: ruled out mid-game: ${added.map(a => a.player).join(", ")}`);
  }
} catch (error) {
  console.warn(`News: ruled-out check skipped: ${error.message}`);
}
