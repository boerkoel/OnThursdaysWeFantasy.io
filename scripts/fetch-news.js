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

await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2) + "\n");
console.log(`News: ${items.length} player headlines in the last 48 hours (${insiderCount} from insiders on Bluesky).`);
