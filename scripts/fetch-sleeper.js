import { readFile, writeFile } from "node:fs/promises";

// Sleeper's free public API, for League Wire stories ESPN's data doesn't
// cover: depth charts (who's next up behind a player ruled out), practice
// reports (Wed-Fri) and league-wide trending adds/drops. Writes a slim
// data/current/sleeper.json keyed by ESPN player id. Sleeper's own espn_id is
// missing for most current players, so players are matched to ESPN's public
// player list by name, team and position (espn_id when there's no match), and
// team defenses are keyed like ESPN's D/ST ids.
//
// Sleeper asks that its ~15 MB players file be fetched at most once a day, so
// only the daily update fetches it; live runs pass SLEEPER_TRENDING_ONLY=true
// to refresh just the (cheap) trending lists, reusing the saved players.
const OUT = process.env.SLEEPER_PATH || "data/current/sleeper.json";
const previous = await readFile(OUT, "utf8").then(JSON.parse).catch(() => null);
// The daily update can run more than once a day (Wednesdays, catch-up runs),
// so the players file is reused if it's under 20 hours old.
const PLAYERS_MAX_AGE_MS = 20 * 60 * 60 * 1000;
const TRENDING_ONLY = process.env.SLEEPER_TRENDING_ONLY === "true" ||
  Date.now() - Date.parse(previous?.playersUpdatedAt || 0) < PLAYERS_MAX_AGE_MS;
const API = "https://api.sleeper.app/v1/players/nfl";
const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
// ESPN's NFL team ids (a D/ST's ESPN player id is -16000 - team id).
const ESPN_TEAM_IDS = { ATL: 1, BUF: 2, CHI: 3, CIN: 4, CLE: 5, DAL: 6, DEN: 7, DET: 8, GB: 9, TEN: 10, IND: 11, KC: 12,
  LV: 13, LAR: 14, MIA: 15, MIN: 16, NE: 17, NO: 18, NYG: 19, NYJ: 20, PHI: 21, ARI: 22, PIT: 23, LAC: 24, SF: 25, SEA: 26,
  TB: 27, WAS: 28, WSH: 28, CAR: 29, JAX: 30, BAL: 33, HOU: 34 };

// ESPN's public player list (no login needed).
const ESPN_PLAYERS = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${process.env.ESPN_SEASON || "2026"}/players?scoringPeriodId=0&view=players_wl`;
const ESPN_POSITIONS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K" };
// "Kenneth Walker III" and "Kenneth Walker" -> "kennethwalker".
const nameKey = name => String(name).toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");

const getJson = async (url, headers = {}) => {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "OnThursdaysWeFantasy/1.0", ...headers } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
};
let players = previous?.players || {};
let playersUpdatedAt = previous?.playersUpdatedAt || null;
if (!TRENDING_ONLY) {
  const [all, espnPlayers] = await Promise.all([getJson(API), getJson(ESPN_PLAYERS, { "X-Fantasy-Filter": JSON.stringify({ filterActive: { value: true } }) })]);
  // ESPN ids by "name|team|position", and by "name|position" when that's unique.
  const espnByKey = new Map(), espnByName = new Map();
  for (const e of espnPlayers) {
    const pos = ESPN_POSITIONS[e.defaultPositionId];
    if (!pos) continue;
    espnByKey.set(`${nameKey(e.fullName)}|${e.proTeamId}|${pos}`, e.id);
    const k = `${nameKey(e.fullName)}|${pos}`;
    espnByName.set(k, espnByName.has(k) ? null : e.id);
  }
  players = {};
  for (const [sid, p] of Object.entries(all)) {
    if (!POSITIONS.has(p.position) || !p.team) continue;
    const name = p.full_name || `${p.first_name} ${p.last_name}`.trim();
    const espnId = p.position === "DEF" ? (ESPN_TEAM_IDS[p.team] ? -16000 - ESPN_TEAM_IDS[p.team] : null)
      : espnByKey.get(`${nameKey(name)}|${ESPN_TEAM_IDS[p.team]}|${p.position}`) ?? espnByName.get(`${nameKey(name)}|${p.position}`) ?? p.espn_id;
    if (!espnId) continue;
    // Only the fields the stories use; empty ones are left out.
    const slim = { sid, name, pos: p.position, team: p.team,
      injury: p.injury_status || null, body: p.injury_body_part || null,
      practice: p.practice_participation || null, practiceNote: p.practice_description || null,
      depthPos: p.depth_chart_position || null, depth: Number.isFinite(p.depth_chart_order) ? p.depth_chart_order : null };
    players[espnId] = Object.fromEntries(Object.entries(slim).filter(([, v]) => v != null));
  }
  playersUpdatedAt = new Date().toISOString();
}

// Trending adds/drops (last 24 hours, all Sleeper leagues), as ESPN ids.
const byId = new Map(Object.entries(players).map(([espnId, p]) => [p.sid, Number(espnId)]));
const trending = async kind => (await getJson(`${API}/trending/${kind}?lookback_hours=24&limit=25`))
  .filter(t => byId.has(String(t.player_id)))
  .map(t => ({ id: byId.get(String(t.player_id)), count: Number(t.count) || 0 }));
const [add, drop] = await Promise.all([trending("add"), trending("drop")]);

await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), playersUpdatedAt, trending: { add, drop }, players }) + "\n");
console.log(`Sleeper: ${Object.keys(players).length} players${TRENDING_ONLY ? " (saved)" : ""}, ${add.length} trending adds, ${drop.length} drops.`);
