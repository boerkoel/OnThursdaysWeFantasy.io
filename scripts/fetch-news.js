import { writeFile } from "node:fs/promises";

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
await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2) + "\n");
console.log(`News: ${items.length} player headlines in the last 48 hours.`);
