import { readFile, writeFile } from "node:fs/promises";

// Second-opinion weekly projections for the simulations (lib/lineup-model.js
// blends them with ESPN's): Sleeper's public projections feed, which carries
// RotoWire's PPR projections, and FantasyPros' expert-consensus points
// (r2p_pts, embedded in their free weekly PPR rankings pages as ecrData). Keyed by ESPN player id via sleeper.json (D/ST:
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
  // Points (standard PPR) plus the stat line, so each league can score it
  // with its own rules (lib/lineup-model.js: leagueScorer).
  const STAT_KEYS = ["pass_yd", "pass_td", "pass_int", "pass_2pt", "pass_fd", "rush_yd", "rush_td", "rush_2pt", "rush_fd",
    "rec", "rec_yd", "rec_td", "rec_2pt", "rec_fd", "fum_lost", "xpm", "fga", "fgm", "fgm_0_19", "fgm_20_29", "fgm_30_39", "fgm_40_49", "fgm_50p"];
  const sleeperPts = {}, sleeperStats = {};
  for (const r of rows) {
    const pts = r?.stats?.pts_ppr;
    const espnId = espnBySid.get(String(r.player_id));
    if (pts == null || espnId == null) continue;
    sleeperPts[espnId] = Math.round(pts * 100) / 100;
    if (r.player?.position !== "DEF") {
      const line = Object.fromEntries(STAT_KEYS.filter(k => Number(r.stats[k])).map(k => [k, Math.round(r.stats[k] * 100) / 100]));
      if (Object.keys(line).length) sleeperStats[espnId] = line;
    }
  }
  const n = Object.keys(sleeperPts).length;
  if (n < 100) throw new Error(`only ${n} players matched; keeping the previous file`);
  const company = rows.find(r => r.company)?.company || "unknown";
  const sources = { sleeper: { label: `Sleeper (${company})`, points: sleeperPts, stats: sleeperStats } };
  try {
    const fp = await fantasyPros(sleeper.players || {});
    if (Object.keys(fp).length >= 100) sources.fantasypros = { label: "FantasyPros consensus", points: fp };
    console.log(`Projections: FantasyPros consensus for ${Object.keys(fp).length} players.`);
  } catch (error) {
    console.warn(`FantasyPros projections skipped: ${error.message}`);
  }
  await writeFile(FILE, JSON.stringify({ week, season, fetchedAt: new Date().toISOString(), sources }) + "\n");
  console.log(`Projections: Sleeper (${company}) for ${n} players, Week ${week}.`);
} catch (error) {
  console.warn(`Projections fetch skipped: ${error.message}${previous ? " (keeping the previous file)" : ""}`);
}

// FantasyPros weekly PPR rankings: each page embeds `ecrData = {players: [...]}`
// with the consensus-derived projected points (r2p_pts). Matched to ESPN ids by
// name + team through sleeper.json (D/ST by team).
async function fantasyPros(sleeperPlayers) {
  const norm = n => String(n || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
  const fixTeam = t => ({ JAC: "JAX", WSH: "WAS" })[t] || t;
  const byNameTeam = new Map(), defByTeam = new Map();
  for (const [espnId, p] of Object.entries(sleeperPlayers)) {
    if (p.pos === "DEF") defByTeam.set(fixTeam(p.team), Number(espnId));
    else byNameTeam.set(`${norm(p.name)}|${fixTeam(p.team)}`, Number(espnId));
  }
  const chances = await readFile("data/current/play-chance.json", "utf8").then(JSON.parse).catch(() => null);
  const doubt = new Map((chances?.players || []).filter(p => p.chance != null).map(p => [`${norm(p.name)}|${fixTeam(p.team)}`, p.chance]));
  const pages = ["qb", "ppr-rb", "ppr-wr", "ppr-te", "k", "dst"];
  const out = {};
  for (const page of pages) {
    const res = await fetch(`https://www.fantasypros.com/nfl/rankings/${page}.php?week=${week}`, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36" } });
    if (!res.ok) throw new Error(`${page}: ${res.status}`);
    const html = await res.text();
    const at = html.indexOf("ecrData");
    if (at < 0) throw new Error(`${page}: no ecrData`);
    const start = html.indexOf("{", at);
    let depth = 0, inString = false, end = -1;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (inString) { if (ch === "\\") i++; else if (ch === "\"") inString = false; continue; }
      if (ch === "\"") inString = true;
      else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const data = JSON.parse(html.slice(start, end));
    for (const p of data.players || []) {
      const pts = Number(p.r2p_pts);
      if (!Number.isFinite(pts)) continue;
      const team = fixTeam(p.player_team_id);
      const id = page === "dst" ? defByTeam.get(team) : byNameTeam.get(`${norm(p.player_name)}|${team}`);
      // FantasyPros' points already discount injured players, and the sims
      // sit players by their chance to play, so skip doubtful ones (and zeros).
      if (id != null && pts > 0.5 && (doubt.get(`${norm(p.player_name)}|${team}`) ?? 1) >= 0.9) out[id] = pts;
    }
  }
  return out;
}
