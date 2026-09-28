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
const counts = new Map(teamIds.map(id => [id, { playoffs: 0, bye: 0, seedSum: 0, pointsSum: 0, raffle: 0 }]));

for (let sim = 0; sim < SIMULATIONS; sim++) {
  const table = new Map([...base].map(([id, row]) => [id, { ...row }]));
  for (const week of remainingWeeks) {
    const weekGames = games.filter(g => g.week === week);
    const scores = new Map();
    for (const id of teamIds) {
      const live = week === currentWeek ? liveWeek?.get(id) : null;
      scores.set(id, live ? Math.max(live.floor - 10, live.mean + live.sd * normal()) : teamMean(id) + weeklySd * normal());
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
    ultimateLoserOdds: odds(SIMULATIONS - c.playoffs),
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
