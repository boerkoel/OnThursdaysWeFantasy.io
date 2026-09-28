import { readFile, readdir, writeFile } from "node:fs/promises";
import { managerKey } from "./lib/history.js";

// All-time record book: champions by season, all-time manager standings, and
// single-game and single-season records. Combines the saved past seasons
// (data/history, from fetch-history.js) with this season's finished games.
// Runs in the daily update, after calculate-stats.js.
const readJson = async p => JSON.parse(await readFile(p, "utf8"));
const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const settings = await readJson("data/current/mSettings.json");
const teamData = await readJson("data/current/mTeam.json");
const currentMatchups = await readJson("data/current/matchups.json");

const pastSeasons = [];
for (const file of (await readdir("data/history").catch(() => [])).filter(f => /^season-\d+\.json$/.test(f))) {
  pastSeasons.push({ ...(await readJson(`data/history/${file}`)), complete: true });
}
const scheduleSettings = settings.settings?.scheduleSettings || {};
const currentSeason = {
  season: Number(settings.seasonId),
  regularSeasonWeeks: Number(scheduleSettings.matchupPeriodCount || 14),
  playoffTeamCount: Number(scheduleSettings.playoffTeamCount || 6),
  complete: false,
  teams: (teamData.teams || []).map(t => ({
    id: Number(t.id),
    manager: managerKey(t.primaryOwner || t.owners?.[0]),
    name: (t.name || `Team ${t.id}`).trim()
  })),
  games: (currentMatchups.matchups || []).filter(m => m.completed).map(m => ({
    week: m.week, home: m.homeTeamId, away: m.awayTeamId, homeScore: m.homeScore, awayScore: m.awayScore,
    winner: m.winner, playoff: m.week > Number(scheduleSettings.matchupPeriodCount || 14)
  }))
};
const seasons = [...pastSeasons, currentSeason].sort((a, b) => a.season - b.season);

// Each manager is labeled by their current team name, or their last one.
const labels = new Map();
for (const season of seasons) for (const t of season.teams) if (t.manager) labels.set(t.manager, t.name);
const label = key => labels.get(key) || "Former manager";

// Every finished game, from each team's side.
const sides = seasons.flatMap(season => {
  const team = new Map(season.teams.map(t => [t.id, t]));
  return season.games
    .filter(g => ["HOME", "AWAY", "TIE"].includes(g.winner) && g.homeScore > 0 && g.awayScore > 0)
    .flatMap(g => [[g.home, g.away, g.homeScore, g.awayScore, "HOME"], [g.away, g.home, g.awayScore, g.homeScore, "AWAY"]]
      .map(([id, oppId, score, oppScore, side]) => ({
        season: season.season,
        week: g.week,
        playoff: Boolean(g.playoff),
        manager: team.get(id)?.manager || null,
        opponentManager: team.get(oppId)?.manager || null,
        team: team.get(id)?.name || `Team ${id}`,
        opponent: team.get(oppId)?.name || `Team ${oppId}`,
        score: round(score),
        opponentScore: round(oppScore),
        result: g.winner === "TIE" ? "T" : g.winner === side ? "W" : "L"
      })));
});
const describeGame = s => ({ season: s.season, week: s.week, playoff: s.playoff, team: s.team, manager: label(s.manager), opponent: s.opponent, score: s.score, opponentScore: s.opponentScore, margin: round(Math.abs(s.score - s.opponentScore)) });
const top = (list, compare, n = 3) => [...list].sort(compare).slice(0, n);
const wins = sides.filter(s => s.result === "W");

const gameRecords = {
  highestScores: top(sides, (a, b) => b.score - a.score).map(describeGame),
  lowestScores: top(sides.filter(s => !s.playoff), (a, b) => a.score - b.score).map(describeGame),
  biggestBlowouts: top(wins, (a, b) => (b.score - b.opponentScore) - (a.score - a.opponentScore)).map(describeGame),
  closestGames: top(wins, (a, b) => (a.score - a.opponentScore) - (b.score - b.opponentScore)).map(describeGame),
  highestLosingScores: top(sides.filter(s => s.result === "L"), (a, b) => b.score - a.score).map(describeGame)
};

// Regular-season totals per finished season.
const seasonTotals = seasons.filter(s => s.complete).flatMap(season => season.teams.map(t => {
  const games = sides.filter(s => s.season === season.season && !s.playoff && s.team === t.name);
  const w = games.filter(g => g.result === "W").length;
  const l = games.filter(g => g.result === "L").length;
  return { season: season.season, team: t.name, manager: label(t.manager), wins: w, losses: l, pointsFor: round(games.reduce((a, g) => a + g.score, 0)), games: games.length };
})).filter(s => s.games);
const seasonRecords = {
  mostPoints: top(seasonTotals, (a, b) => b.pointsFor - a.pointsFor),
  fewestPoints: top(seasonTotals, (a, b) => a.pointsFor - b.pointsFor),
  bestRecords: top(seasonTotals, (a, b) => b.wins / b.games - a.wins / a.games || b.pointsFor - a.pointsFor)
};

const champions = seasons.filter(s => s.complete).map(season => {
  const byRank = rank => season.teams.find(t => t.finalRank === rank);
  const last = [...season.teams].filter(t => t.finalRank).sort((a, b) => b.finalRank - a.finalRank)[0];
  const entry = t => t ? { team: t.name, manager: label(t.manager) } : null;
  return { season: season.season, champion: entry(byRank(1)), runnerUp: entry(byRank(2)), third: entry(byRank(3)), lastPlace: entry(last) };
}).reverse();

// All-time standings by manager (regular-season head-to-head record).
const managers = [...new Set(seasons.flatMap(s => s.teams.map(t => t.manager)).filter(Boolean))].map(key => {
  const reg = sides.filter(s => s.manager === key && !s.playoff);
  const w = reg.filter(s => s.result === "W").length;
  const l = reg.filter(s => s.result === "L").length;
  const t = reg.filter(s => s.result === "T").length;
  const finished = seasons.filter(s => s.complete).map(s => ({ season: s, team: s.teams.find(x => x.manager === key) })).filter(x => x.team);
  return {
    manager: label(key),
    seasons: seasons.filter(s => s.teams.some(x => x.manager === key)).length,
    wins: w, losses: l, ties: t,
    winPct: reg.length ? round((w + t / 2) / reg.length * 100) : 0,
    pointsFor: round(reg.reduce((a, s) => a + s.score, 0)),
    averageScore: reg.length ? round(reg.reduce((a, s) => a + s.score, 0) / reg.length) : 0,
    titles: finished.filter(x => x.team.finalRank === 1).length,
    runnerUps: finished.filter(x => x.team.finalRank === 2).length,
    playoffAppearances: finished.filter(x => x.team.playoffSeed && x.team.playoffSeed <= x.season.playoffTeamCount).length,
    bestFinish: Math.min(...finished.map(x => x.team.finalRank || 99)) === 99 ? null : Math.min(...finished.map(x => x.team.finalRank || 99))
  };
}).sort((a, b) => b.titles - a.titles || b.winPct - a.winPct || b.pointsFor - a.pointsFor);

// Head-to-head rivalries: every pair of managers who have played, from the
// first manager's side (a is the manager whose key sorts first).
const pairKey = (x, y) => [x, y].sort().join("|");
const meetings = new Map();
for (const s of sides) {
  if (!s.manager || !s.opponentManager || s.manager > s.opponentManager) continue; // one side per game
  const key = pairKey(s.manager, s.opponentManager);
  if (!meetings.has(key)) meetings.set(key, []);
  meetings.get(key).push(s);
}
const rivalries = [...meetings.entries()].map(([key, games]) => {
  const [a, b] = key.split("|");
  games.sort((x, y) => x.season - y.season || x.week - y.week);
  const aWins = games.filter(g => g.result === "W").length;
  const bWins = games.filter(g => g.result === "L").length;
  const last = games[games.length - 1];
  let streak = 0;
  for (let i = games.length - 1; i >= 0 && games[i].result === last.result; i--) streak++;
  const biggest = side => {
    const pool = games.filter(g => g.result === (side === "a" ? "W" : "L"));
    const g = pool.sort((x, y) => Math.abs(y.score - y.opponentScore) - Math.abs(x.score - x.opponentScore))[0];
    return g ? { season: g.season, week: g.week, margin: round(Math.abs(g.score - g.opponentScore)), score: side === "a" ? g.score : g.opponentScore, opponentScore: side === "a" ? g.opponentScore : g.score } : null;
  };
  return {
    a, b,
    games: games.length,
    aWins, bWins,
    ties: games.length - aWins - bWins,
    aPoints: round(games.reduce((t, g) => t + g.score, 0)),
    bPoints: round(games.reduce((t, g) => t + g.opponentScore, 0)),
    playoffMeetings: games.filter(g => g.playoff).length,
    lastMeeting: { season: last.season, week: last.week, playoff: last.playoff, aScore: last.score, bScore: last.opponentScore, winner: last.result === "W" ? a : last.result === "L" ? b : null },
    streak: last.result === "T" ? null : { manager: last.result === "W" ? a : b, length: streak },
    biggestWin: { a: biggest("a"), b: biggest("b") }
  };
});

await writeFile("data/current/record-book.json", JSON.stringify({
  seasons: seasons.map(s => s.season),
  throughWeek: Math.max(0, ...currentSeason.games.map(g => g.week)),
  currentSeason: currentSeason.season,
  champions,
  managers,
  gameRecords,
  seasonRecords,
  // For rivalries: managers' display labels, and this season's team id ->
  // manager, so live matchups can show their all-time series.
  managerLabels: Object.fromEntries([...labels]),
  currentTeamManagers: Object.fromEntries(currentSeason.teams.map(t => [t.id, t.manager])),
  rivalries
}, null, 2) + "\n");

console.log(`Record book: ${seasons.length} seasons (${pastSeasons.length} past), ${managers.length} managers, ${sides.length / 2} games.`);
