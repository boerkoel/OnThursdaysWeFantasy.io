import { readFile, writeFile } from "node:fs/promises";
import { altProjectionFn, leagueScorer } from "./lib/lineup-model.js";

// Each projection source's pregame number for every rostered player, and what he scored (Jim, 2026-11-09: weight
// the sources by how accurate each has been here, by position). Run by the daily job, after
// update-live-scoreboard.js; kept in data/history (committed, never loaded by the app).
// - Pregame: a player's entry is refreshed on every run until his game kicks off, so it ends up as the last
//   numbers before kickoff: espn (ESPN), fp (FantasyPros' consensus points, raw), sl (Sleeper's stat line scored
//   with this league's rules) or slPts (Sleeper's PPR points, when there's no stat line).
// - actual: ESPN's points once his game is over; for a past week still missing some (Monday night, a dropped
//   player), Sleeper's stat line scored with this league's rules. D/ST without an ESPN actual stays null.
const matchup = await readFile("data/current/mMatchup.json", "utf8").then(JSON.parse).catch(() => null);
const roster = await readFile("data/current/mRoster.json", "utf8").then(JSON.parse).catch(() => null);
const scoreboard = await readFile("data/current/scoreboard.json", "utf8").then(JSON.parse).catch(() => null);
const scoringItems = await readFile("data/current/mSettings.json", "utf8").then(JSON.parse).then(m => m.settings?.scoringSettings?.scoringItems || null).catch(() => null);
const week = Number(matchup?.scoringPeriodId) || 0;
const season = Number(matchup?.seasonId || new Date().getFullYear());
if (!week || !roster?.teams) { console.warn("Projection sources: no week or roster; skipping."); process.exit(0); }
const FILE = `data/history/projection-sources-${season}.json`;
const saved = await readFile(FILE, "utf8").then(JSON.parse).catch(() => ({ season, weeks: {} }));

const POS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };
const r1 = x => Number.isFinite(Number(x)) && x !== null ? Math.round(Number(x) * 10) / 10 : null;
const stat = (player, source) => {
  const s = (player?.stats || []).find(x => Number(x.scoringPeriodId) === week && Number(x.statSourceId) === source && Number(x.statSplitTypeId) === 1);
  return Number(s?.appliedTotal);
};
const games = Number(scoreboard?.week) === week ? scoreboard.nflGames || [] : [];
const gameOf = new Map(games.flatMap(g => (g.teamIds || []).map(id => [Number(id), g])));
const alt = await altProjectionFn(week, scoringItems);

const wk = saved.weeks[week] || { players: {} };
let pregame = 0, actuals = 0;
for (const team of roster.teams) for (const entry of team.roster?.entries || []) {
  const player = entry.playerPoolEntry?.player;
  const game = player && gameOf.get(Number(player.proTeamId));
  if (!player || !game) continue;   // on bye, or no schedule
  const id = String(player.id), pos = POS[Number(player.defaultPositionId)] || String(player.defaultPositionId);
  if (game.state === "pre") {
    const a = alt(player);
    wk.players[id] = { pos, espn: r1(stat(player, 1)), fp: r1(a.fp), sl: r1(a.scored), slPts: r1(a.sleeper) };
    pregame++;
  } else if (game.completed && wk.players[id] && wk.players[id].actual == null && Number.isFinite(stat(player, 0))) {
    wk.players[id].actual = r1(stat(player, 0));
    actuals++;
  }
}
wk.savedAt = new Date().toISOString();
saved.weeks[week] = wk;

// Past weeks still missing actuals: Sleeper's stat lines, scored with this league's rules.
const score = scoringItems ? leagueScorer(scoringItems) : null;
const sleeper = await readFile("data/current/sleeper.json", "utf8").then(JSON.parse).catch(() => null);
const sidOf = new Map(Object.entries(sleeper?.players || {}).map(([espnId, p]) => [espnId, String(p.sid)]));
for (const [key, w] of Object.entries(saved.weeks)) {
  if (Number(key) >= week || !score) continue;
  const missing = Object.entries(w.players).filter(([, p]) => p.actual == null && p.pos !== "D/ST");
  if (!missing.length) continue;
  try {
    const res = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${season}/${key}`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const lines = await res.json();
    let filled = 0;
    for (const [id, p] of missing) {
      const line = lines?.[sidOf.get(id)];
      if (line) { p.actual = r1(score(line)); p.actualFrom = "sleeper"; filled++; }
    }
    console.log(`Projection sources: Week ${key}, ${filled} of ${missing.length} missing actuals filled from Sleeper.`);
  } catch (error) {
    console.warn(`Projection sources: Week ${key} actuals from Sleeper failed: ${error.message}`);
  }
}

await writeFile(FILE, JSON.stringify(saved) + "\n");
console.log(`Projection sources: Week ${week}, ${pregame} pregame entries refreshed, ${actuals} actuals saved (${Object.keys(wk.players).length} players).`);
