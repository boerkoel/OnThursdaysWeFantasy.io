import { readFile, writeFile } from "node:fs/promises";

// Second-opinion weekly projections for the simulations (lib/lineup-model.js
// blends them with ESPN's): Sleeper's public projections feed, which carries
// RotoWire's PPR projections. Keyed by ESPN player id via sleeper.json (D/ST:
// -16000 - ESPN team id, as there). Live runs call this too, so it skips the
// download when the saved copy for this week is under MAX_AGE_MS old (FORCE=1
// to override).
const FILE = "data/current/projections.json";
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

const matchup = await readFile("data/current/mMatchup.json", "utf8").then(JSON.parse).catch(() => null);
const scoreboard = await readFile("data/current/scoreboard.json", "utf8").then(JSON.parse).catch(() => null);
const week = Math.max(Number(matchup?.scoringPeriodId) || 0, Number(scoreboard?.week) || 0);
const season = Number(matchup?.seasonId || new Date().getFullYear());
const previous = await readFile(FILE, "utf8").then(JSON.parse).catch(() => null);
if (!week) { console.warn("Projections: no current week; skipping."); process.exit(0); }
if (previous?.week === week && !process.env.FORCE && Date.now() - Date.parse(previous.fetchedAt) < MAX_AGE_MS) {
  console.log(`Projections for Week ${week} are fresh (${previous.fetchedAt}); skipping.`);
  process.exit(0);
}

try {
  const sleeper = JSON.parse(await readFile("data/current/sleeper.json", "utf8"));
  const espnBySid = new Map(Object.entries(sleeper.players || {}).map(([espnId, p]) => [String(p.sid), Number(espnId)]));
  const query = POSITIONS.map(p => `position%5B%5D=${p}`).join("&");
  const response = await fetch(`https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&${query}`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const rows = await response.json();
  const sleeperPts = {};
  for (const r of rows) {
    const pts = r?.stats?.pts_ppr;
    const espnId = espnBySid.get(String(r.player_id));
    if (pts == null || espnId == null) continue;
    sleeperPts[espnId] = Math.round(pts * 100) / 100;
  }
  const n = Object.keys(sleeperPts).length;
  if (n < 100) throw new Error(`only ${n} players matched; keeping the previous file`);
  const company = rows.find(r => r.company)?.company || "unknown";
  await writeFile(FILE, JSON.stringify({ week, season, fetchedAt: new Date().toISOString(),
    sources: { sleeper: { label: `Sleeper (${company})`, points: sleeperPts } } }) + "\n");
  console.log(`Projections: Sleeper (${company}) for ${n} players, Week ${week}.`);
} catch (error) {
  console.warn(`Projections fetch skipped: ${error.message}${previous ? " (keeping the previous file)" : ""}`);
}
