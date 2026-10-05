import { readFile, writeFile } from "node:fs/promises";
import { round } from "../lib/simulation.js";
import { BENCH_SLOT, IR_SLOT } from "../lib/lineup.js";

// League Wire: shared data and helpers (loads every input; everything here is read-only for the stories).
export function money(n){return Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "0.00"}
export const readJson = async p => JSON.parse(await readFile(p, "utf8"));
// Where to read and write (data/current normally; scripts/test-wire.js points
// these at a captured snapshot), and the clock (a snapshot replays at the
// time it was captured, so time windows behave as they did live).
export const DATA = process.env.WIRE_DATA_DIR || "data/current";
export const OUT = process.env.WIRE_OUT_DIR || DATA;
export const clockNow = () => Number(process.env.WIRE_NOW) || Date.now();
export const writeJson = async (p, v) => writeFile(p, JSON.stringify(v, null, 2) + "\n");

export const previousScoreboard = await readJson(process.env.PREVIOUS_SCOREBOARD_PATH || `${DATA}/scoreboard.json`).catch(() => null);
export const teamData = await readJson(`${DATA}/mTeam.json`);
export const matchupData = await readJson(`${DATA}/mMatchup.json`);
export const guillotineData = await readJson(`${DATA}/guillotine.json`).catch(() => null);
export const liveScoringData = await readJson(`${DATA}/mLiveScoring.json`);
export const boxscoreData = await readJson(`${DATA}/mBoxscore.json`);
export const rosterData = await readJson(`${DATA}/mRoster.json`).catch(() => ({ teams: [] }));

export const teamNames = new Map((teamData.teams || []).map(t => [t.id, (t.name || "").trim()]));
export const name = id => teamNames.get(id) || "Team " + id;
export const currentWeek = Number(matchupData.scoringPeriodId || 1);
export const currentWeekMatchups = (matchupData.schedule || [])
  .filter(m => m.home?.teamId && m.away?.teamId && Number(m.matchupPeriodId) === currentWeek)
  .map(m => ({ id:m.id, week:m.matchupPeriodId, homeTeamId:m.home.teamId, awayTeamId:m.away.teamId, winner:m.winner, completed:m.winner==="HOME"||m.winner==="AWAY" }));

// ESPN's mBoxscore response includes schedule entries for many/all matchup
// periods. Only use entries for the current matchup period; otherwise later
// zero-valued future matchups can overwrite the live totals for the same team.
export const liveSchedule = (liveScoringData.schedule || []).filter(g => Number(g.matchupPeriodId) === currentWeek);
export const boxscoreSchedule = (boxscoreData.schedule || []).filter(g => Number(g.matchupPeriodId) === currentWeek);
export const allLiveSchedules = [...liveSchedule, ...boxscoreSchedule];

// The live scoreboard (scores, ESPN projections, Monte Carlo odds) is built by
// update-live-scoreboard.js, which must run before this script.
export const liveScoreboard = await readJson(`${DATA}/scoreboard.json`);
export const currentScores = Number(liveScoreboard.week) === currentWeek ? (liveScoreboard.scores || []) : [];
export const projectedMedian = Number(liveScoreboard.projectedMedian);
// "Near median" is decided by update-live-scoreboard.js (the teams on either
// side of the projected median, plus any with 30-70% above-median odds).
export const isNearMedian = s => Boolean(s?.nearMedian);


// ---- Live lineup model for the League Wire ----------------------------------
// NFL game status comes from update-live-scoreboard.js via scoreboard.json.
export const nflGames = Number(liveScoreboard.week) === currentWeek ? (liveScoreboard.nflGames || []) : [];
export const nflGameByProTeam = new Map(nflGames.flatMap(g => (g.teamIds || []).map(id => [Number(id), g])));

// One entry per fantasy team: its players this week with weekly points,
// projection, lineup slot and NFL game status.
export const liveTeams = new Map();
for (const g of allLiveSchedules) for (const side of [g.home, g.away]) {
  if (!side?.teamId || liveTeams.has(Number(side.teamId))) continue;
  const teamId = Number(side.teamId);
  const players = (side.rosterForCurrentScoringPeriod?.entries || [])
    .filter(entry => entry.playerPoolEntry?.player && Number(entry.lineupSlotId) !== IR_SLOT)
    .map(entry => {
      const player = entry.playerPoolEntry.player;
      const game = nflGameByProTeam.get(Number(player.proTeamId)) || null;
      const projection = Number((player.stats || []).find(s => Number(s.scoringPeriodId) === currentWeek && Number(s.statSourceId) === 1 && Number(s.statSplitTypeId) === 1)?.appliedTotal);
      return {
        playerId:Number(entry.playerId),
        name:player.fullName,
        lastName:player.lastName || player.fullName,
        teamId,
        slot:Number(entry.lineupSlotId),
        bench:Number(entry.lineupSlotId) === BENCH_SLOT,
        actual:round(Number(entry.playerPoolEntry.appliedStatTotal ?? 0)),
        projection:Number.isFinite(projection) ? round(projection) : null,
        eligibleSlots:(player.eligibleSlots || []).map(Number),
        positionId:Number(player.defaultPositionId),
        game,
        // No game this week (bye) counts as finished with its current points.
        finished:game ? game.completed : nflGames.length > 0,
        playing:game?.state === "in",
        upcoming:game?.state === "pre"
      };
    });
  liveTeams.set(teamId, {teamId, team:name(teamId), players});
}

// Games worth talking about right now: those in progress, or if none are,
// the most recent kickoff slot that has finished.
export function recentGameIds() {
  const live = nflGames.filter(g => g.state === "in");
  if (live.length) return new Set(live.map(g => g.id));
  const done = nflGames.filter(g => g.completed && g.kickoff);
  if (!done.length) return new Set();
  const latest = Math.max(...done.map(g => Date.parse(g.kickoff)));
  return new Set(done.filter(g => Date.parse(g.kickoff) >= latest - 60 * 60 * 1000).map(g => g.id));
}

export const pts = n => money(n) + " pts";
// Odds for display: whole numbers, one decimal near the ends (under 10% or
// over 90%) so 0.4% isn't "0%" and 99.6% doesn't look like a lock; exactly
// 0% / 100% only when decided.
export const pct = n => {
  if (n == null || n === "" || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  if (v <= 0) return "0%";
  if (v >= 100) return "100%";
  if (v < 0.1) return "<0.1%";
  if (v > 99.9) return ">99.9%";
  return (v < 10 || v > 90 ? v.toFixed(1).replace(/\.0$/, "") : String(Math.round(v))) + "%";
};
// "Ollie Gordon II" -> "Gordon" (suffixes aren't names).
export const surname = full => String(full).replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, "").split(" ").slice(-1)[0];
export const possessive = team => team + (team.endsWith("s") ? "'" : "'s");
export const listNames = names => names.length <= 1 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
// "Swift and D/ST (PHI @ CHI)": players ({name, game}) with each game named once.
export function playersWithGames(players) {
  const games = [...new Set(players.map(p => p.game || ""))];
  return listNames(games.map(g => listNames(players.filter(p => (p.game || "") === g).map(p => p.name)) + (g ? " (" + g + ")" : "")));
}
// Stories should fit in about three lines on a phone (the pinned wire box is
// as tall as its longest story). fit() takes a story's versions, longest
// first, and returns the first that fits (or the shortest).
export const STORY_MAX_CHARS = 160;
export const fit = (...versions) => versions.find(v => v.length <= STORY_MAX_CHARS) ?? versions.reduce((a, b) => b.length < a.length ? b : a);


// ---- Sass -------------------------------------------------------------------
// Several lines per situation; the pick is fixed per team/player/week so a
// story doesn't change wording on every refresh.
export function pickLine(key, lines) {
  let h = 2166136261;
  for (const c of key + "|" + currentWeek) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return lines[h % lines.length];
}

// Season-level inputs (optional files: the stories cope when one is missing).
export const season = Number(process.env.ESPN_SEASON || matchupData.seasonId || new Date().getFullYear());
export async function readOptional(path) { return readJson(path).catch(() => null); }
export const recordBook = await readOptional(`${DATA}/record-book.json`);
export const standingsData = await readOptional(`${DATA}/standings.json`);
export const seasonOddsData = await readOptional(`${DATA}/season-odds.json`);
