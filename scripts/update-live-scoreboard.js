import { readFile, writeFile } from "node:fs/promises";

const season = process.env.ESPN_SEASON || "2026";
const leagueId = process.env.ESPN_LEAGUE_ID || "998599827";
const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`;
const espnS2 = process.env.ESPN_S2;
const swid = process.env.ESPN_SWID;

if (!espnS2 || !swid) throw new Error("Missing ESPN authentication secrets.");

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function teamName(teams, id) {
  return teams.get(Number(id))?.name || `Team ${id}`;
}

const matchup = JSON.parse(await readFile("data/current/mMatchup.json", "utf8"));
const previousScoreboard = await readFile("data/current/scoreboard.json", "utf8").then(JSON.parse).catch(() => null);
const teamData = JSON.parse(await readFile("data/current/mTeam.json", "utf8"));
const liveScoringData = JSON.parse(await readFile("data/current/mLiveScoring.json", "utf8"));
const boxscoreData = JSON.parse(await readFile("data/current/mBoxscore.json", "utf8"));
const scoreboardData = JSON.parse(await readFile("data/current/mScoreboard.json", "utf8"));
const rosterData = JSON.parse(await readFile("data/current/mRoster.json", "utf8"));

const currentWeek = Number(matchup.scoringPeriodId || 1);
const teams = new Map((teamData.teams || []).map(t => [
  Number(t.id),
  { name: (t.name || "").trim(), abbrev: t.abbrev || "", logo: t.logo || null }
]));
const matchups = (matchup.schedule || [])
  .filter(m => m.home?.teamId && m.away?.teamId)
  .map(m => ({
    id: m.id,
    week: Number(m.matchupPeriodId),
    homeTeamId: Number(m.home.teamId),
    awayTeamId: Number(m.away.teamId),
    homeScore: Number(m.home.totalPoints || 0),
    awayScore: Number(m.away.totalPoints || 0),
    winner: m.winner,
    completed: m.winner === "HOME" || m.winner === "AWAY"
  }));

const currentWeekMatchups = matchups.filter(m => m.week === currentWeek);
const completed = matchups.filter(m => m.completed);

const liveSchedule = (liveScoringData.schedule || []).filter(g => Number(g.matchupPeriodId) === currentWeek);
const boxscoreSchedule = (boxscoreData.schedule || []).filter(g => Number(g.matchupPeriodId) === currentWeek);
const liveByTeam = new Map();

for (const g of [...liveSchedule, ...boxscoreSchedule]) {
  for (const side of [g.home, g.away]) {
    if (!side?.teamId) continue;
    const playerTotal = (side.rosterForCurrentScoringPeriod?.entries || [])
      .filter(entry => Number(entry.lineupSlotId) !== 20)
      .reduce((sum, entry) => sum + Number(entry.playerPoolEntry?.appliedStatTotal ?? 0), 0);
    const reportedLive = Number(side.totalPointsLive);
    const reportedTotal = Number(side.totalPoints);
    const fallbackScore = Number(side.cumulativeScore?.score ?? 0);
    const liveScore = Number.isFinite(reportedLive) && reportedLive > 0
      ? reportedLive
      : playerTotal > 0
        ? playerTotal
        : Number.isFinite(reportedTotal)
          ? reportedTotal
          : fallbackScore;
    liveByTeam.set(Number(side.teamId), liveScore);
  }
}

const espnProjectionByTeam = new Map();
const projectionTeamDetails = new Map();

async function fetchNflSchedule(date) {
  const dateString = date.toISOString().slice(0, 10).replace(/-/g, "");
  const response = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateString}`,
    { headers: { Accept: "application/json", "User-Agent": "OnThursdaysWeFantasy/1.0" } }
  );
  if (!response.ok) return null;
  return response.json();
}

const now = new Date();
const [nflToday, nflTomorrow] = await Promise.all([
  fetchNflSchedule(now),
  fetchNflSchedule(new Date(now.getTime() + 86400000))
]);

const nflGamesByTeam = new Map();
for (const event of [...(nflToday?.events || []), ...(nflTomorrow?.events || [])]) {
  const competition = event.competitions?.[0];
  if (!competition) continue;
  const status = competition.status?.type;
  for (const competitor of competition.competitors || []) {
    const teamId = Number(competitor.team?.id);
    if (Number.isFinite(teamId)) nflGamesByTeam.set(teamId, {
      started: Boolean(status?.state && status.state !== "pre"),
      completed: status?.completed === true || status?.state === "post"
    });
  }
}

function weeklyProjection(player) {
  const stats = player?.stats || [];
  const projected = stats.find(s =>
    Number(s.scoringPeriodId) === currentWeek &&
    Number(s.statSourceId) === 1 &&
    Number(s.statSplitTypeId) === 1
  );
  return Number(projected?.appliedTotal);
}

function rosterEntriesForTeam(teamId) {
  const team = (rosterData.teams || []).find(t => Number(t.id) === Number(teamId));
  return team?.roster?.entries ||
    team?.rosterForCurrentScoringPeriod?.entries ||
    [];
}

for (const teamId of teams.keys()) {
  const entries = rosterEntriesForTeam(teamId)
    .filter(entry => Number(entry.lineupSlotId) !== 20);

  let projectedFinal = 0;
  let hasProjection = false;

  for (const entry of entries) {
    const player = entry.playerPoolEntry?.player;
    const actual = Number(entry.playerPoolEntry?.appliedStatTotal ?? 0);
    const fullProjection = weeklyProjection(player);
    if (!Number.isFinite(fullProjection)) {
      projectedFinal += actual;
      continue;
    }

    hasProjection = true;
    const proTeamId = Number(player?.proTeamId);
    const game = nflGamesByTeam.get(proTeamId);

    if (game?.completed) {
      projectedFinal += actual;
    } else if (game?.started) {
      projectedFinal += actual + Math.max(0, fullProjection - actual);
    } else {
      projectedFinal += Math.max(actual, fullProjection);
    }
  }

  if (hasProjection) {
    const currentScore = liveByTeam.get(teamId) ?? 0;
    // Never allow the live projection to fall below points already scored.
    espnProjectionByTeam.set(teamId, round(Math.max(currentScore, projectedFinal)));
    projectionTeamDetails.set(teamId, { players: entries.length });
  }
}

const liveProjectionTeamIds = new Set(espnProjectionByTeam.keys());

const previousProjectionHistory = previousScoreboard?.projectionHistory || [];
const currentProjectionSnapshot = {
  timestamp: new Date().toISOString(),
  week: currentWeek,
  scores: [...espnProjectionByTeam.entries()].map(([teamId, projection]) => ({ teamId, projection }))
};
const projectionHistory = [
  ...previousProjectionHistory.filter(snapshot => Number(snapshot.week) === currentWeek),
  currentProjectionSnapshot
].slice(-4);

const priorThreeSnapshots = projectionHistory.slice(0, -1).slice(-3);
const recentProjectionAverage = new Map();
for (const teamId of teams.keys()) {
  const values = priorThreeSnapshots
    .map(snapshot => (snapshot.scores || []).find(s => Number(s.teamId) === Number(teamId))?.projection)
    .map(Number)
    .filter(Number.isFinite);
  if (values.length) recentProjectionAverage.set(teamId, values.reduce((sum, value) => sum + value, 0) / values.length);
}

const currentScores = currentWeekMatchups.flatMap(m => [
  { teamId: m.homeTeamId, opponentId: m.awayTeamId, score: liveByTeam.get(m.homeTeamId) ?? m.homeScore, opponentScore: liveByTeam.get(m.awayTeamId) ?? m.awayScore, matchupId: m.id },
  { teamId: m.awayTeamId, opponentId: m.homeTeamId, score: liveByTeam.get(m.awayTeamId) ?? m.awayScore, opponentScore: liveByTeam.get(m.homeTeamId) ?? m.homeScore, matchupId: m.id }
]).map(x => {
  const projection = espnProjectionByTeam.get(x.teamId) ?? null;
  const baseline = recentProjectionAverage.get(x.teamId);
  const delta = Number.isFinite(projection) && Number.isFinite(baseline) ? projection - baseline : null;
  const matchup = currentWeekMatchups.find(m => m.id === x.matchupId);
  return {
    ...x,
    team: teamName(teams, x.teamId),
    opponent: teamName(teams, x.opponentId),
    logo: teams.get(x.teamId)?.logo || null,
    projection: { espn: projection },
    projectionAverage: projection,
    projectionTrend: Number.isFinite(delta) && Math.abs(delta) >= 0.25 ? (delta > 0 ? "up" : "down") : null,
    status: matchup?.completed ? "FINAL" : "LIVE"
  };
}).sort((a,b) => b.score - a.score);

function medianOf(values) {
  const sorted = values.filter(Number.isFinite).sort((a,b) => a-b);
  if (!sorted.length) return null;
  return sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)] : round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
}

const median = medianOf(currentScores.map(s => Number(s.score)));
const projectedMedian = medianOf(currentScores.map(s => Number(s.projectionAverage)));

function historicalScores(teamId) {
  return completed.filter(m => m.homeTeamId === teamId || m.awayTeamId === teamId)
    .map(m => m.homeTeamId === teamId ? m.homeScore : m.awayScore)
    .filter(Number.isFinite);
}

function rngFactory(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
}

function normalSample(rng) {
  const u = Math.max(rng(), 1e-12);
  const v = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

let seed = 2166136261;
for (const value of currentScores.map(s => [s.teamId, s.score, s.projectionAverage]).sort((a,b) => a[0] - b[0]).flat()) {
  for (const char of String(value)) { seed ^= char.charCodeAt(0); seed = Math.imul(seed, 16777619); }
}
seed >>>= 0;

const probabilityTeams = currentScores.map(s => {
  const historical = historicalScores(s.teamId);
  const mean = historical.length ? historical.reduce((sum,v) => sum + v, 0) / historical.length : Number(s.projectionAverage) || Number(s.score) || 0;
  const variance = historical.length > 1 ? historical.reduce((sum,v) => sum + (v - mean) ** 2, 0) / (historical.length - 1) : 0;
  const historicalSd = Math.sqrt(Math.max(0, variance));
  const projectedFinal = Number(s.projectionAverage);
  const currentScore = Number(s.score) || 0;
  const remainingProjection = Number.isFinite(projectedFinal) ? Math.max(0, projectedFinal - currentScore) : 0;
  const fallbackSd = Math.max(12, remainingProjection * 0.30);
  const remainingFraction = Number.isFinite(projectedFinal) && projectedFinal > 0 ? Math.max(0, Math.min(1, remainingProjection / projectedFinal)) : 1;
  const sd = Math.max(8, (historicalSd || fallbackSd) * Math.sqrt(Math.max(0.2, remainingFraction)));
  return { ...s, projectedFinal: Number.isFinite(projectedFinal) ? projectedFinal : currentScore, currentScore, remainingProjection, sd };
});

const SIMULATIONS = 10000;
const rng = rngFactory(seed);
const winCounts = new Map(probabilityTeams.map(s => [s.teamId, 0]));
const aboveMedianCounts = new Map(probabilityTeams.map(s => [s.teamId, 0]));
const matchupLookup = new Map(currentWeekMatchups.map(m => [m.id, m]));

for (let sim = 0; sim < SIMULATIONS; sim++) {
  const finals = probabilityTeams.map(s => ({
    teamId: s.teamId,
    // Keep uncertainty even when a stale/lagging projection is below the
    // current score. A live projection should normally stay at or above the
    // current score, but we never want that data-quality edge case to turn
    // the matchup into a deterministic 100% win.
    score: s.currentScore + Math.max(0, s.remainingProjection + s.sd * normalSample(rng))
  }));
  for (const matchup of currentWeekMatchups) {
    const home = finals.find(s => s.teamId === matchup.homeTeamId);
    const away = finals.find(s => s.teamId === matchup.awayTeamId);
    if (!home || !away) continue;
    if (home.score > away.score) winCounts.set(home.teamId, winCounts.get(home.teamId) + 1);
    else if (away.score > home.score) winCounts.set(away.teamId, winCounts.get(away.teamId) + 1);
    else { winCounts.set(home.teamId, winCounts.get(home.teamId) + 0.5); winCounts.set(away.teamId, winCounts.get(away.teamId) + 0.5); }
  }
  const sortedFinals = [...finals].sort((a,b) => a.score - b.score);
  const middle = Math.floor(sortedFinals.length / 2);
  const medianFinal = sortedFinals.length >= 2 ? (sortedFinals[middle - 1].score + sortedFinals[middle].score) / 2 : null;
  if (Number.isFinite(medianFinal)) for (const final of finals) if (final.score > medianFinal) aboveMedianCounts.set(final.teamId, aboveMedianCounts.get(final.teamId) + 1);
}

for (const score of currentScores) {
  const matchup = matchupLookup.get(score.matchupId);
  const actualWinner = matchup?.winner === "HOME" ? matchup.homeTeamId : matchup?.winner === "AWAY" ? matchup.awayTeamId : null;
  score.winProbability = matchup?.completed ? (score.teamId === actualWinner ? 100 : 0) : round((winCounts.get(score.teamId) || 0) / SIMULATIONS * 100);
  score.aboveMedianProbability = round((aboveMedianCounts.get(score.teamId) || 0) / SIMULATIONS * 100);
}

await writeFile("data/current/scoreboard.json", JSON.stringify({
  week: currentWeek,
  lastUpdated: new Date().toISOString(),
  scores: currentScores,
  median,
  projectedMedian,
  projectionSources: ["ESPN player projections"],
  probabilityModel: "Site-calculated live projections from ESPN player projections plus Monte Carlo uncertainty",
  probabilitySimulations: SIMULATIONS,
  projectionHistory
}, null, 2) + "\n");

console.log(`Updated live scoreboard for Week ${currentWeek} with ${currentScores.length} teams; ESPN live projections available for ${liveProjectionTeamIds.size} teams.`);
if (liveProjectionTeamIds.size === 0) console.warn("WARNING: No player-level ESPN projections were available for live projection calculation.");
