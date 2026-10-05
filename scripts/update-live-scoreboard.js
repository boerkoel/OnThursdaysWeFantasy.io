import { readFile, writeFile } from "node:fs/promises";
import { BENCH_SLOT, IR_SLOT, settledLineupRegret } from "./lib/lineup.js";
import { SIMULATIONS, medianOf, playerOutlook, possibleOdds, round, scoreRange, seededRng, simulateFinal } from "./lib/simulation.js";

const season = process.env.ESPN_SEASON || "2026";
const leagueId = process.env.ESPN_LEAGUE_ID || "998599827";
const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`;
const espnS2 = process.env.ESPN_S2;
const swid = process.env.ESPN_SWID;

if (!espnS2 || !swid) throw new Error("Missing ESPN authentication secrets.");

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

// ESPN's live matchup response can expose a team-level projected final score.
// Prefer that value whenever ESPN supplies it; it is the clearest source for the
// league site. Fall back to our player-level remaining-projection model only when
// ESPN does not provide a usable team projection.
const espnTeamProjectionByTeam = new Map();
for (const g of [...liveSchedule, ...boxscoreSchedule]) {
  for (const side of [g.home, g.away]) {
    if (!side?.teamId) continue;
    const candidates = [side.totalProjectedPointsLive, side.projectedScore, side.projectedTotal, side.projection, side.totalPointsProjected];
    // Number(null) is 0, so require a positive value to count as a real projection.
    const projection = candidates.map(Number).find(value => Number.isFinite(value) && value > 0);
    if (projection != null) espnTeamProjectionByTeam.set(Number(side.teamId), projection);
  }
}

const espnProjectionByTeam = new Map();
const projectionTeamDetails = new Map();

// Fetch the whole NFL week (not today/tomorrow by date) so games that finished
// earlier in the week, including Thursday and primetime games, are known to be
// complete. Fantasy scoring periods line up with NFL regular-season weeks.
async function fetchNflWeek(week) {
  const response = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&season=${season}`,
    { headers: { Accept: "application/json", "User-Agent": "OnThursdaysWeFantasy/1.0" } }
  );
  if (!response.ok) return null;
  return response.json();
}

const nflWeek = await fetchNflWeek(currentWeek);

const nflGamesByTeam = new Map();
// Published in scoreboard.json so the League Wire can focus on current games.
const nflGames = [];
for (const event of nflWeek?.events || []) {
  const competition = event.competitions?.[0];
  if (!competition) continue;
  const status = competition.status?.type;
  const game = {
    id: String(event.id),
    name: event.shortName || event.name || "",
    kickoff: event.date || null,
    state: status?.state || "pre",
    completed: status?.completed === true || status?.state === "post",
    detail: status?.shortDetail || "",
    teamIds: (competition.competitors || []).map(c => Number(c.team?.id)).filter(Number.isFinite),
    // For the matchup cards' lineups: "@CLE 24-27 Final".
    teams: (competition.competitors || []).map(c => ({ id: Number(c.team?.id), abbrev: c.team?.abbreviation || "", score: Number(c.score) || 0, home: c.homeAway === "home" }))
  };
  nflGames.push(game);
  for (const teamId of game.teamIds) nflGamesByTeam.set(teamId, game);
}

// statSourceId 1 = ESPN projection, 0 = actual; statSplitTypeId 1 = single week.
function weeklyStat(player, statSourceId) {
  const stat = (player?.stats || []).find(s =>
    Number(s.scoringPeriodId) === currentWeek &&
    Number(s.statSourceId) === statSourceId &&
    Number(s.statSplitTypeId) === 1
  );
  return Number(stat?.appliedTotal);
}

const weeklyProjection = player => weeklyStat(player, 1);

function rosterEntriesForTeam(teamId) {
  const team = (rosterData.teams || []).find(t => Number(t.id) === Number(teamId));
  return team?.roster?.entries ||
    team?.rosterForCurrentScoringPeriod?.entries ||
    [];
}

// Starters whose NFL game hasn't finished, as simulation inputs. A team with
// none left can no longer change its score. If the NFL schedule couldn't be
// fetched, assume everyone is still playing.
const remainingPlayersByTeam = new Map();

for (const teamId of teams.keys()) {
  const entries = rosterEntriesForTeam(teamId)
    .filter(entry => Number(entry.lineupSlotId) !== 20 && Number(entry.lineupSlotId) !== 21);

  // Store only points still expected from the lineup. The live team score
  // is added separately, so already-scored points are never counted twice.
  let remainingProjection = 0;
  let hasProjection = false;
  const remainingPlayers = [];

  for (const entry of entries) {
    const player = entry.playerPoolEntry?.player;
    // mRoster's appliedStatTotal is season-to-date, so use this week's actual.
    const weeklyActual = weeklyStat(player, 0);
    const actual = Number.isFinite(weeklyActual) ? weeklyActual : 0;
    const fullProjection = weeklyProjection(player);
    if (player) {
      const nflGame = nflGamesByTeam.get(Number(player.proTeamId));
      // Teams missing from the week's schedule are on bye.
      if (!nflWeek || (nflGame && !nflGame.completed)) {
        remainingPlayers.push(playerOutlook({ actual, projection: fullProjection, positionId: player.defaultPositionId }));
      }
    }
    if (!Number.isFinite(fullProjection)) continue;

    hasProjection = true;
    const game = nflGamesByTeam.get(Number(player?.proTeamId));

    if (game?.completed) {
      // Completed games contribute only the actual score.
      continue;
    }

    // For games that are not complete, ESPN's weekly projection represents
    // the player's expected total. Since actual points are already included
    // in currentScore, add only the unearned portion of that projection.
    // Do not time-discount in-progress games: ESPN's live projection is not a
    // simple percentage-of-clock calculation.
    remainingProjection += Math.max(0, fullProjection - actual);
  }
  remainingPlayersByTeam.set(teamId, remainingPlayers);

  if (hasProjection) {
    const currentScore = liveByTeam.get(teamId) ?? 0;
    // Never allow the live projection to fall below points already scored.
    espnProjectionByTeam.set(teamId, round(currentScore + remainingProjection));
    projectionTeamDetails.set(teamId, { players: entries.length });
  }
}

const liveProjectionTeamIds = new Set(espnProjectionByTeam.keys());

// Each team's lineup for the matchup cards: the starters, plus (once their
// games are over) bench players who outscored a starter they could have
// replaced, and what the best possible lineup would have scored.
const INJURY_SHORT = { QUESTIONABLE: "Q", DOUBTFUL: "D", OUT: "O", INJURY_RESERVE: "IR", SUSPENSION: "SSPD" };
const POSITIONS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };
const lineupByTeam = new Map();
for (const teamId of teams.keys()) {
  const players = rosterEntriesForTeam(teamId)
    .filter(entry => entry.playerPoolEntry?.player && Number(entry.lineupSlotId) !== IR_SLOT)
    .map(entry => {
      const player = entry.playerPoolEntry.player;
      const actual = weeklyStat(player, 0);
      const projection = weeklyProjection(player);
      const game = nflGamesByTeam.get(Number(player.proTeamId));
      const slot = Number(entry.lineupSlotId);
      return {
        id: Number(entry.playerId),
        name: /D\/ST/.test(player.fullName) ? player.fullName : (player.firstName ? player.firstName[0] + ". " : "") + (player.lastName || player.fullName),
        pos: POSITIONS[Number(player.defaultPositionId)] || "",
        proTeamId: Number(player.proTeamId),
        slot,
        bench: slot === BENCH_SLOT,
        actual: Number.isFinite(actual) ? round(actual) : 0,
        projection: Number.isFinite(projection) ? round(projection) : null,
        injury: INJURY_SHORT[player.injuryStatus] || null,
        eligibleSlots: (player.eligibleSlots || []).map(Number),
        // No game this week (bye) counts as finished.
        finished: game ? game.completed : nflGames.length > 0
      };
    });
  const regret = settledLineupRegret(players);
  const card = ({ eligibleSlots, finished, bench, ...p }) => p;
  lineupByTeam.set(teamId, {
    starters: players.filter(p => !p.bench).map(card),
    regretBench: regret.pointsLeft > 0 ? regret.regretBench.map(card) : [],
    pointsLeft: regret.pointsLeft
  });
}

const currentScores = currentWeekMatchups.flatMap(m => [
  { teamId: m.homeTeamId, opponentId: m.awayTeamId, score: liveByTeam.get(m.homeTeamId) ?? m.homeScore, opponentScore: liveByTeam.get(m.awayTeamId) ?? m.awayScore, matchupId: m.id },
  { teamId: m.awayTeamId, opponentId: m.homeTeamId, score: liveByTeam.get(m.awayTeamId) ?? m.awayScore, opponentScore: liveByTeam.get(m.homeTeamId) ?? m.homeScore, matchupId: m.id }
]).map(x => {
  const projection = espnTeamProjectionByTeam.get(x.teamId) ?? espnProjectionByTeam.get(x.teamId) ?? null;
  const matchup = currentWeekMatchups.find(m => m.id === x.matchupId);
  return {
    ...x,
    team: teamName(teams, x.teamId),
    opponent: teamName(teams, x.opponentId),
    logo: teams.get(x.teamId)?.logo || null,
    projection: { espn: projection },
    projectionAverage: projection,
    projectionTrend: null,
    status: matchup?.completed ? "FINAL" : "LIVE",
    lineup: lineupByTeam.get(x.teamId) || null
  };
}).sort((a,b) => b.score - a.score);

const median = round(medianOf(currentScores.map(s => Number(s.score))) ?? 0);

// Each team's final score = current score + a simulated amount from every
// starter still to play (see lib/simulation.js). The displayed projection is
// still ESPN's; the simulations drive win odds, median odds and spread.
const probabilityTeams = currentScores.map(s => ({
  teamId: s.teamId,
  score: Number(s.score) || 0,
  players: remainingPlayersByTeam.get(s.teamId) || []
}));
const projectedMedian = round(medianOf(currentScores.map(s => Number(s.projectionAverage ?? s.score))) ?? median);

const rng = seededRng(currentScores.map(s => [s.teamId, s.score, s.projectionAverage]).sort((a, b) => a[0] - b[0]));
const simulationSums = new Map(probabilityTeams.map(s => [s.teamId, 0]));
const simulationSquaredSums = new Map(probabilityTeams.map(s => [s.teamId, 0]));
const aboveMedianCounts = new Map(probabilityTeams.map(s => [s.teamId, 0]));
// The week's highest score earns a raffle ticket.
const topScoreCounts = new Map(probabilityTeams.map(s => [s.teamId, 0]));
const winCounts = new Map(probabilityTeams.map(s => [s.teamId, 0]));

for (let sim = 0; sim < SIMULATIONS; sim++) {
  const simulatedFinals = new Map();
  for (const team of probabilityTeams) {
    const finalScore = simulateFinal(team, rng);
    simulatedFinals.set(team.teamId, finalScore);
    simulationSums.set(team.teamId, simulationSums.get(team.teamId) + finalScore);
    simulationSquaredSums.set(team.teamId, simulationSquaredSums.get(team.teamId) + finalScore ** 2);
  }

  // The league median moves with everyone's final score, so compare each team
  // to the median of this simulated week rather than to a fixed projection.
  const simulatedMedian = medianOf([...simulatedFinals.values()]);
  for (const [teamId, finalScore] of simulatedFinals) {
    if (finalScore > simulatedMedian) aboveMedianCounts.set(teamId, aboveMedianCounts.get(teamId) + 1);
  }
  let topTeam = null;
  for (const [teamId, finalScore] of simulatedFinals) if (topTeam === null || finalScore > simulatedFinals.get(topTeam)) topTeam = teamId;
  if (topTeam !== null) topScoreCounts.set(topTeam, topScoreCounts.get(topTeam) + 1);

  for (const matchup of currentWeekMatchups) {
    if (matchup.completed) continue;
    const homeFinal = simulatedFinals.get(matchup.homeTeamId);
    const awayFinal = simulatedFinals.get(matchup.awayTeamId);
    if (homeFinal > awayFinal) winCounts.set(matchup.homeTeamId, winCounts.get(matchup.homeTeamId) + 1);
    else if (awayFinal > homeFinal) winCounts.set(matchup.awayTeamId, winCounts.get(matchup.awayTeamId) + 1);
  }
}

const simulatedSdByTeam = new Map();
for (const team of probabilityTeams) {
  const sum = simulationSums.get(team.teamId) || 0;
  const sumSquares = simulationSquaredSums.get(team.teamId) || 0;
  const mean = sum / SIMULATIONS;
  const variance = Math.max(0, sumSquares / SIMULATIONS - mean ** 2);
  simulatedSdByTeam.set(team.teamId, Math.sqrt(variance));
}

// Outcomes are reported exactly (0% or 100%) only when locked, judged from each
// team's lowest and highest possible final score; otherwise possibleOdds keeps
// them between 0.01% and 99.99%.
const rangeByTeam = new Map(probabilityTeams.map(t => [t.teamId, scoreRange(t)]));
const halfOfLeague = currentScores.length / 2;
// Surely the week's top score: its worst case beats everyone's best case.
// Surely not: someone's worst case beats its best case.
function lockedTopScoreOdds(score) {
  const me = rangeByTeam.get(score.teamId);
  const others = currentScores.filter(s => s.teamId !== score.teamId).map(s => rangeByTeam.get(s.teamId));
  if (others.every(o => me.min > o.max)) return 100;
  if (others.some(o => o.min > me.max)) return 0;
  return null;
}

function lockedMedianOdds(score) {
  const me = rangeByTeam.get(score.teamId);
  const others = currentScores.filter(s => s.teamId !== score.teamId).map(s => rangeByTeam.get(s.teamId));
  // Surely top half: too few others can finish above this team's worst case.
  if (others.filter(o => o.max > me.min).length < halfOfLeague) return 100;
  // Surely bottom half: enough others are sure to finish above its best case.
  if (others.filter(o => o.min > me.max).length >= halfOfLeague) return 0;
  return null;
}

for (const score of currentScores) {
  const espnProjection = Number(score.projection?.espn);
  const sd = simulatedSdByTeam.get(score.teamId) || 0;
  const aboveCount = aboveMedianCounts.get(score.teamId) || 0;

  score.projectionSd = round(sd);
  score.startersLeft = (remainingPlayersByTeam.get(score.teamId) || []).length;
  score.aboveMedianProbability = lockedMedianOdds(score) ?? possibleOdds(aboveCount);
  score.topScoreProbability = lockedTopScoreOdds(score) ?? possibleOdds(topScoreCounts.get(score.teamId) || 0);
  score.belowMedianProbability = round(100 - score.aboveMedianProbability);
  score.medianDistanceSd = sd > 0
    ? round((espnProjection - projectedMedian) / sd)
    : 0;
  score.closeToMedian = Math.abs(score.medianDistanceSd) <= 0.5;
}

// "Near median": the teams just above and just below the projected median are
// always near it, plus any team with a 30-70% chance of finishing above it.
const NEAR_MEDIAN_MIN = 30;
const NEAR_MEDIAN_MAX = 70;
const projectionOf = s => Number(s.projectionAverage ?? s.score);
const justBelow = currentScores.filter(s => projectionOf(s) <= projectedMedian).sort((a, b) => projectionOf(b) - projectionOf(a))[0];
const justAbove = currentScores.filter(s => projectionOf(s) >= projectedMedian && s !== justBelow).sort((a, b) => projectionOf(a) - projectionOf(b))[0];
// The two teams projected closest to the median are flagged, unless the
// team's side of the median is already locked (exactly 0% or 100%).
const medianLocked = score => score.aboveMedianProbability <= 0 || score.aboveMedianProbability >= 100;
for (const score of currentScores) {
  score.nearMedian = ((score === justBelow || score === justAbove) && !medianLocked(score)) ||
    (score.aboveMedianProbability >= NEAR_MEDIAN_MIN && score.aboveMedianProbability <= NEAR_MEDIAN_MAX);
}

for (const matchup of currentWeekMatchups) {
  const home = currentScores.find(s => s.teamId === matchup.homeTeamId);
  const away = currentScores.find(s => s.teamId === matchup.awayTeamId);
  if (!home || !away) continue;

  if (matchup.completed) {
    home.winProbability = matchup.winner === "HOME" ? 100 : 0;
    away.winProbability = matchup.winner === "AWAY" ? 100 : 0;
  } else if (rangeByTeam.get(home.teamId).min > rangeByTeam.get(away.teamId).max) {
    home.winProbability = 100;
    away.winProbability = 0;
  } else if (rangeByTeam.get(away.teamId).min > rangeByTeam.get(home.teamId).max) {
    home.winProbability = 0;
    away.winProbability = 100;
  } else if (!probabilityTeams.find(t => t.teamId === home.teamId).players.length &&
             !probabilityTeams.find(t => t.teamId === away.teamId).players.length) {
    // Both done and tied.
    home.winProbability = 50;
    away.winProbability = 50;
  } else {
    home.winProbability = possibleOdds(winCounts.get(home.teamId) || 0);
    away.winProbability = possibleOdds(winCounts.get(away.teamId) || 0);
  }
}
 
const previousProjectionHistory = previousScoreboard?.projectionHistory || [];
const priorThreeSnapshots = previousProjectionHistory
  .filter(snapshot => Number(snapshot.week) === currentWeek)
  .slice(-3);
const recentProjectionAverage = new Map();
for (const teamId of teams.keys()) {
  const values = priorThreeSnapshots
    .map(snapshot => (snapshot.scores || []).find(s => Number(s.teamId) === Number(teamId))?.projection)
    .map(Number)
    .filter(Number.isFinite);
  if (values.length) recentProjectionAverage.set(teamId, values.reduce((sum, value) => sum + value, 0) / values.length);
}

for (const score of currentScores) {
  const espnProjection = Number(score.projection?.espn);
  const baseline = recentProjectionAverage.get(score.teamId);
  const delta = Number.isFinite(espnProjection) && Number.isFinite(baseline)
    ? espnProjection - baseline
    : null;
  score.projection = { espn: Number.isFinite(espnProjection) ? espnProjection : score.score };
  score.projectionAverage = Number.isFinite(espnProjection) ? espnProjection : score.score;
  score.projectionTrend = Number.isFinite(delta) && Math.abs(delta) >= 0.25
    ? (delta > 0 ? "up" : "down")
    : null;
}

const currentProjectionSnapshot = {
  timestamp: new Date().toISOString(),
  week: currentWeek,
  scores: currentScores.map(score => ({ teamId: score.teamId, projection: Number(score.projection?.espn) }))
};
const projectionHistory = [
  ...previousProjectionHistory.filter(snapshot => Number(snapshot.week) === currentWeek),
  currentProjectionSnapshot
].slice(-4);

// Win-odds history for this week's swing charts and comeback stories: one
// snapshot per update while odds are moving, thinned out if it gets long.
const MAX_WIN_HISTORY = 400;
const winSnapshot = { t: new Date().toISOString(), p: Object.fromEntries(currentScores.map(s => [s.teamId, s.winProbability])) };
let winHistory = Number(previousScoreboard?.winHistory?.week) === currentWeek ? [...(previousScoreboard.winHistory.points || [])] : [];
const lastSnapshot = winHistory[winHistory.length - 1];
const oddsMoved = !lastSnapshot || Object.entries(winSnapshot.p).some(([id, p]) => lastSnapshot.p?.[id] !== p);
if (oddsMoved) winHistory.push(winSnapshot);
if (winHistory.length > MAX_WIN_HISTORY) {
  // Keep every other older point and all of the most recent 100.
  winHistory = winHistory.filter((_, i) => i % 2 === 0 || i >= winHistory.length - 100);
}

await writeFile("data/current/scoreboard.json", JSON.stringify({
  week: currentWeek,
  lastUpdated: new Date().toISOString(),
  scores: currentScores,
  median,
  projectedMedian,
  projectionSources: ["ESPN live team projections, with ESPN player projections as fallback"],
  probabilityModel: "Monte Carlo simulations estimate final-score distributions, above/below projected-median odds, matchup win odds, and final-score standard deviation; ESPN projections remain the displayed projections",
  probabilitySimulations: SIMULATIONS,
  nflGames,
  winHistory: { week: currentWeek, points: winHistory },
  projectionHistory
}, null, 2) + "\n");

console.log(`Updated live scoreboard for Week ${currentWeek} with ${currentScores.length} teams; ESPN live projections available for ${liveProjectionTeamIds.size} teams.`);
if (liveProjectionTeamIds.size === 0) console.warn("WARNING: No player-level ESPN projections were available for live projection calculation.");
