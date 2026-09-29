import { readFile, writeFile } from "node:fs/promises";
import { SIMULATIONS, possibleOdds, round, seededRng } from "./lib/simulation.js";

// Rest-of-season odds: simulates the remaining regular-season weeks to
// estimate each team's chance of making the playoffs, earning a bye, landing
// in the Ultimate Loser bracket, and winning the raffle. Runs with the live
// updates (after update-live-scoreboard.js) and in the daily update.
const readJson = async p => JSON.parse(await readFile(p, "utf8"));

const settings = await readJson("data/current/mSettings.json");
const teamData = await readJson("data/current/mTeam.json");
const matchupData = await readJson("data/current/mMatchup.json");
const scoreboard = await readJson("data/current/scoreboard.json").catch(() => null);

const schedule = settings.settings?.scheduleSettings || {};
const regularSeasonWeeks = Number(schedule.matchupPeriodCount || 14);
const playoffTeamCount = Number(schedule.playoffTeamCount || 6);
const byeCount = 2;
const seedByPoints = (schedule.playoffSeedingRule || "TOTAL_POINTS_SCORED") === "TOTAL_POINTS_SCORED";
const currentWeek = Number(matchupData.scoringPeriodId || 1);

const teamIds = (teamData.teams || []).map(t => Number(t.id));
const teamName = new Map((teamData.teams || []).map(t => [Number(t.id), (t.name || "").trim()]));
const games = (matchupData.schedule || [])
  .filter(m => m.home?.teamId && m.away?.teamId && Number(m.matchupPeriodId) <= regularSeasonWeeks)
  .map(m => ({
    week: Number(m.matchupPeriodId),
    home: Number(m.home.teamId),
    away: Number(m.away.teamId),
    homeScore: Number(m.home.totalPoints || 0),
    awayScore: Number(m.away.totalPoints || 0),
    completed: m.winner === "HOME" || m.winner === "AWAY"
  }));
const weeks = [...new Set(games.map(g => g.week))].sort((a, b) => a - b);
const completedWeeks = weeks.filter(w => games.filter(g => g.week === w).every(g => g.completed));
const remainingWeeks = weeks.filter(w => !completedWeeks.includes(w));

// Scoring so far, for each team's expected weekly score. Averages are pulled
// toward the league average (as if the team had a few extra average weeks),
// since a few weeks of results say only so much.
const REGRESSION_WEEKS = 3;
const pastScores = new Map(teamIds.map(id => [id, []]));
for (const g of games.filter(g => g.completed)) {
  pastScores.get(g.home)?.push(g.homeScore);
  pastScores.get(g.away)?.push(g.awayScore);
}
const allScores = [...pastScores.values()].flat();
const leagueMean = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 110;
const teamMean = id => {
  const scores = pastScores.get(id) || [];
  return (scores.reduce((a, b) => a + b, 0) + REGRESSION_WEEKS * leagueMean) / (scores.length + REGRESSION_WEEKS);
};
// Week-to-week spread around each team's own average, pooled across teams.
const residuals = [...pastScores.entries()].flatMap(([id, scores]) => {
  const avg = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
  return scores.map(s => s - avg);
});
const weeklySd = residuals.length > teamIds.length
  ? Math.max(15, Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / (residuals.length - teamIds.length)))
  : 25;

// Future weeks aren't just more of the same:
// - Rosters change. Each team's edge over (or gap below) the league average
//   shrinks the further ahead the week is, and fastest for teams with the best
//   waiver priority (usually the teams at the bottom, who can use the wire).
// - Byes and injuries add week-to-week variance beyond what's been observed.
// - In NFL weeks 17-18 many starters rest, so those weeks are much noisier.
const RETENTION_BEST_PRIORITY = 0.88;  // per week ahead, for waiver priority #1
const RETENTION_WORST_PRIORITY = 0.96; // per week ahead, for the last priority
const BYES_AND_INJURIES_SD = 1.15;
const RESTING_STARTERS_SD = 1.4;
const waiverRank = new Map((teamData.teams || []).map(t => [Number(t.id), Number(t.waiverRank) || teamIds.length]));
const retention = id => {
  const share = teamIds.length > 1 ? (waiverRank.get(id) - 1) / (teamIds.length - 1) : 1; // 0 = first priority
  return RETENTION_BEST_PRIORITY + (RETENTION_WORST_PRIORITY - RETENTION_BEST_PRIORITY) * Math.min(1, Math.max(0, share));
};
const weekMean = (id, week) => leagueMean + (teamMean(id) - leagueMean) * retention(id) ** Math.max(0, week - currentWeek);
const weekSd = week => weeklySd * BYES_AND_INJURIES_SD * (week >= 17 ? RESTING_STARTERS_SD : 1);
const simulateScore = (id, week) => weekMean(id, week) + weekSd(week) * normal();

// The week in progress uses the live scoreboard: each team's projected final
// and the spread from its own simulation.
const liveWeek = scoreboard && Number(scoreboard.week) === currentWeek && remainingWeeks.includes(currentWeek)
  ? new Map((scoreboard.scores || []).map(s => [Number(s.teamId), { mean: Number(s.projectionAverage ?? s.score), sd: Number(s.projectionSd || 0), floor: Number(s.score) }]))
  : null;

// Standing so far: points for, wins (head-to-head plus the weekly median win),
// and raffle tickets (each week's highest score).
const base = new Map(teamIds.map(id => [id, { pointsFor: 0, wins: 0, tickets: 0 }]));
for (const week of completedWeeks) {
  const weekGames = games.filter(g => g.week === week);
  const scores = weekGames.flatMap(g => [[g.home, g.homeScore], [g.away, g.awayScore]]);
  addWeek(base, weekGames, new Map(scores));
}
function addWeek(table, weekGames, scoreByTeam) {
  const sorted = [...scoreByTeam.values()].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  let top = null;
  for (const [id, score] of scoreByTeam) {
    const row = table.get(id);
    if (!row) continue;
    row.pointsFor += score;
    if (score > median) row.wins += 1;
    if (!top || score > top[1]) top = [id, score];
  }
  for (const g of weekGames) {
    const h = scoreByTeam.get(g.home), a = scoreByTeam.get(g.away);
    if (h > a) table.get(g.home).wins += 1;
    else if (a > h) table.get(g.away).wins += 1;
  }
  if (top) table.get(top[0]).tickets += 1;
}

const rng = seededRng([currentWeek, [...base.values()], scoreboard?.lastUpdated || null]);
const normal = () => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
const counts = new Map(teamIds.map(id => [id, { playoffs: 0, bye: 0, seedSum: 0, pointsSum: 0, raffle: 0, title: 0, ultimateLoser: 0 }]));

// Postseason, simulated in full each run. Championship: #3v#6 and #4v#5 in
// week 15, then #1 plays the lowest remaining seed and #2 the other, final in
// week 17. Ultimate Loser (lower score advances): non-playoff seeds 12..7 as
// #1-#6, the lower-ranked week-15 loser #7 and the higher-ranked #8; 1v8, 2v7,
// 3v6, 4v5 in week 16, reseeded semifinals in week 17, final in week 18.
// Scores already played on ESPN are used as-is. Only for the league's shape:
// 12 teams, 6 in the playoffs.
const bracketFits = teamIds.length === 12 && playoffTeamCount === 6;
const actualScores = new Map();
for (const m of matchupData.schedule || []) {
  if (!(m.winner === "HOME" || m.winner === "AWAY")) continue;
  for (const side of [m.home, m.away]) if (side?.teamId) actualScores.set(`${m.matchupPeriodId}-${side.teamId}`, Number(side.totalPoints || 0));
}
function simulatePostseason(seedOrder) {
  const seedOf = id => seedOrder.indexOf(id) + 1;
  const score = (id, week) => actualScores.get(`${week}-${id}`) ?? simulateScore(id, week);
  // Returns [advancing, eliminated]; ties go to the first (higher-seeded) team.
  const play = (a, b, week, lowerAdvances) => {
    const sa = score(a, week), sb = score(b, week);
    return (lowerAdvances ? sa <= sb : sa >= sb) ? [a, b] : [b, a];
  };
  const qfWeek = regularSeasonWeeks + 1;
  const [winner36, loser36] = play(seedOrder[2], seedOrder[5], qfWeek, false);
  const [winner45, loser45] = play(seedOrder[3], seedOrder[4], qfWeek, false);
  const lowestFirst = [winner36, winner45].sort((a, b) => seedOf(b) - seedOf(a));
  const [finalist1] = play(seedOrder[0], lowestFirst[0], qfWeek + 1, false);
  const [finalist2] = play(seedOrder[1], lowestFirst[1], qfWeek + 1, false);
  const [champion] = play(finalist1, finalist2, qfWeek + 2, false);

  const playoffLosers = [loser36, loser45].sort((a, b) => seedOf(b) - seedOf(a));
  const ultimate = [...seedOrder.slice(6).reverse(), ...playoffLosers];
  const ultimateSeed = id => ultimate.indexOf(id) + 1;
  const ulWeek = qfWeek + 1;
  const quarterfinals = [[0, 7], [1, 6], [2, 5], [3, 4]].map(([a, b]) => play(ultimate[a], ultimate[b], ulWeek, true)[0]);
  const reseeded = quarterfinals.sort((a, b) => ultimateSeed(a) - ultimateSeed(b));
  const [semi1] = play(reseeded[0], reseeded[3], ulWeek + 1, true);
  const [semi2] = play(reseeded[1], reseeded[2], ulWeek + 1, true);
  const [ultimateLoser] = play(semi1, semi2, ulWeek + 2, true);
  return { champion, ultimateLoser };
}

for (let sim = 0; sim < SIMULATIONS; sim++) {
  const table = new Map([...base].map(([id, row]) => [id, { ...row }]));
  for (const week of remainingWeeks) {
    const weekGames = games.filter(g => g.week === week);
    const scores = new Map();
    for (const id of teamIds) {
      const live = week === currentWeek ? liveWeek?.get(id) : null;
      scores.set(id, live ? Math.max(live.floor - 10, live.mean + live.sd * normal()) : simulateScore(id, week));
    }
    addWeek(table, weekGames, scores);
  }
  const order = [...table.entries()].sort(([, a], [, b]) =>
    seedByPoints ? b.pointsFor - a.pointsFor : b.wins - a.wins || b.pointsFor - a.pointsFor);
  order.forEach(([id, row], index) => {
    const c = counts.get(id);
    if (index < playoffTeamCount) c.playoffs++;
    if (index < byeCount) c.bye++;
    c.seedSum += index + 1;
    c.pointsSum += row.pointsFor;
  });
  const totalTickets = [...table.values()].reduce((a, r) => a + r.tickets, 0);
  if (totalTickets) for (const [id, row] of table) counts.get(id).raffle += row.tickets / totalTickets;
  if (bracketFits) {
    const { champion, ultimateLoser } = simulatePostseason(order.map(([id]) => id));
    counts.get(champion).title++;
    counts.get(ultimateLoser).ultimateLoser++;
  }
}

// Once the regular season is over, results are exact.
const odds = count => remainingWeeks.length ? possibleOdds(count) : round(count / SIMULATIONS * 100);
const teams = teamIds.map(id => {
  const c = counts.get(id);
  return {
    teamId: id,
    team: teamName.get(id) || `Team ${id}`,
    pointsFor: round(base.get(id).pointsFor),
    projectedPointsFor: round(c.pointsSum / SIMULATIONS),
    averageSeed: round(c.seedSum / SIMULATIONS),
    playoffOdds: odds(c.playoffs),
    byeOdds: odds(c.bye),
    // Share of simulations each team ends as champion / Ultimate Loser; each
    // column sums to 100%.
    titleOdds: bracketFits ? round(c.title / SIMULATIONS * 100) : null,
    ultimateLoserOdds: bracketFits ? round(c.ultimateLoser / SIMULATIONS * 100) : null,
    raffleOdds: round(c.raffle / SIMULATIONS * 100)
  };
}).sort((a, b) => b.playoffOdds - a.playoffOdds || a.averageSeed - b.averageSeed);

await writeFile("data/current/season-odds.json", JSON.stringify({
  week: currentWeek,
  lastUpdated: new Date().toISOString(),
  simulations: SIMULATIONS,
  remainingWeeks,
  seeding: seedByPoints ? "points" : "record",
  playoffTeamCount,
  teams
}, null, 2) + "\n");

console.log(`Season odds: ${remainingWeeks.length} weeks left; playoff odds ${teams.map(t => `${t.team.split(" ")[0]} ${t.playoffOdds}%`).join(", ")}.`);
