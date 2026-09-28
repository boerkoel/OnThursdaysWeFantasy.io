import { writeFile } from "node:fs/promises";

// Death Watch for the companion guillotine league (public on ESPN, so no
// cookies are needed): each week the lowest-scoring surviving team is
// chopped. Simulates the rest of the week to estimate each team's odds of
// finishing last.
const season = process.env.ESPN_SEASON || "2026";
const leagueId = process.env.GUILLOTINE_LEAGUE_ID || "687798070";
const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`;

const SIMULATIONS = 10000;
// Spread of a player's remaining points, as a fraction of what's projected.
const PLAYER_SD_FRACTION = 0.6;
const BENCH_SLOT = 20;
const IR_SLOT = 21;

const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "OnThursdaysWeFantasy/1.0" } });
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchLeague(views, scoringPeriodId) {
  const url = new URL(base);
  for (const view of views) url.searchParams.append("view", view);
  if (scoringPeriodId != null) url.searchParams.set("scoringPeriodId", String(scoringPeriodId));
  return fetchJson(url);
}

const league = await fetchLeague(["mSettings", "mTeam"]);
const week = Number(league.scoringPeriodId || league.status?.currentMatchupPeriod || 1);
const [scores, rosters, nflWeek] = await Promise.all([
  fetchLeague(["mMatchupScore"], week),
  fetchLeague(["mRoster"], week),
  fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&season=${season}`).catch(() => null)
]);

const nflGameByProTeam = new Map();
for (const event of nflWeek?.events || []) {
  const competition = event.competitions?.[0];
  const status = competition?.status?.type;
  const game = { name: event.shortName || "", completed: status?.completed === true || status?.state === "post" };
  for (const c of competition?.competitors || []) nflGameByProTeam.set(Number(c.team?.id), game);
}

const weeklyStat = (player, statSourceId) => Number((player?.stats || []).find(s =>
  Number(s.scoringPeriodId) === week && Number(s.statSourceId) === statSourceId && Number(s.statSplitTypeId) === 1
)?.appliedTotal);

const teamInfo = new Map((league.teams || []).map(t => [Number(t.id), { name: (t.name || `Team ${t.id}`).trim(), abbrev: t.abbrev || "" }]));
const weekEntry = (scores.schedule || []).find(g => Number(g.matchupPeriodId) === week);
const scoreByTeam = new Map((weekEntry?.teams || []).map(t => [Number(t.teamId), t]));
const rosterByTeam = new Map((rosters.teams || []).map(t => [Number(t.id), t.roster?.entries || []]));

// eliminationMatchupPeriod is 0 while a team is alive, else the week it was chopped.
const chopped = (weekEntry?.teams || [])
  .filter(t => Number(t.eliminationMatchupPeriod) > 0)
  .map(t => ({ teamId: Number(t.teamId), team: teamInfo.get(Number(t.teamId))?.name, week: Number(t.eliminationMatchupPeriod) }))
  .sort((a, b) => b.week - a.week);

const alive = [...scoreByTeam.values()]
  .filter(t => Number(t.eliminationMatchupPeriod) === 0)
  .map(t => {
    const teamId = Number(t.teamId);
    const remaining = [];
    for (const entry of rosterByTeam.get(teamId) || []) {
      const slot = Number(entry.lineupSlotId);
      const player = entry.playerPoolEntry?.player;
      if (slot === BENCH_SLOT || slot === IR_SLOT || !player) continue;
      const game = nflGameByProTeam.get(Number(player.proTeamId));
      // Bye weeks (no game) and finished games have nothing left to add.
      if (nflWeek && (!game || game.completed)) continue;
      const actual = Number.isFinite(weeklyStat(player, 0)) ? weeklyStat(player, 0) : 0;
      const projection = weeklyStat(player, 1);
      const rest = Number.isFinite(projection) ? Math.max(0, projection - actual) : 0;
      remaining.push({ name: player.fullName, game: game?.name || "", actual: round(actual), rest });
    }
    const score = round(Number(t.totalPointsLive ?? t.totalPoints ?? 0));
    return {
      teamId,
      team: teamInfo.get(teamId)?.name || `Team ${teamId}`,
      abbrev: teamInfo.get(teamId)?.abbrev || "",
      score,
      projected: round(score + remaining.reduce((sum, p) => sum + p.rest, 0)),
      remaining
    };
  });

// Seeded so odds don't jitter between refreshes when nothing changed.
let state = 2166136261;
for (const char of JSON.stringify(alive.map(t => [t.teamId, t.score, t.projected]))) {
  state ^= char.charCodeAt(0);
  state = Math.imul(state, 16777619) >>> 0;
}
const rng = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
const normal = () => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());

const chopCounts = new Map(alive.map(t => [t.teamId, 0]));
for (let sim = 0; sim < SIMULATIONS; sim++) {
  const finals = alive.map(t => ({
    teamId: t.teamId,
    score: t.score + t.remaining.reduce((sum, p) => sum + Math.max(0, p.rest + PLAYER_SD_FRACTION * p.rest * normal()), 0)
  }));
  const lowest = Math.min(...finals.map(f => f.score));
  const last = finals.filter(f => f.score === lowest);
  for (const f of last) chopCounts.set(f.teamId, chopCounts.get(f.teamId) + 1 / last.length);
}

// Exact 0%/100% only when locked (scores can't go down); otherwise start each
// team with one simulated chop and one survival so odds never read 0 or 100.
const isDone = t => t.remaining.length === 0;
for (const t of alive) {
  const others = alive.filter(o => o.teamId !== t.teamId);
  const surelySafe = others.some(o => isDone(o) && o.score < t.score);
  const surelyChopped = isDone(t) && others.every(o => o.score > t.score);
  t.chopProbability = surelySafe ? 0 : surelyChopped ? 100 : round(((chopCounts.get(t.teamId) + 1) / (SIMULATIONS + 2)) * 100);
  t.playersLeft = t.remaining.length;
  t.remaining = t.remaining.map(p => ({ name: p.name, game: p.game, actual: p.actual, projectedRest: round(p.rest) }));
}
// What a team with players left needs to climb past the lowest team that's
// already finished (the score it must beat to be sure it isn't last).
for (const t of alive) {
  if (!t.playersLeft) continue;
  const floor = alive.filter(o => o.teamId !== t.teamId && o.playersLeft === 0).sort((a, b) => a.score - b.score)[0];
  if (floor && floor.score >= t.score) {
    t.survivalNeed = { points: round(floor.score - t.score + 0.01), passTeam: floor.team };
  }
}
alive.sort((a, b) => b.chopProbability - a.chopProbability || a.projected - b.projected);

await writeFile("data/current/guillotine.json", JSON.stringify({
  leagueId,
  leagueName: league.settings?.name || "Guillotine League",
  week,
  lastUpdated: new Date().toISOString(),
  simulations: SIMULATIONS,
  teams: alive,
  chopped
}, null, 2) + "\n");

console.log(`Guillotine week ${week}: ${alive.length} teams alive; most at risk: ${alive.slice(0, 3).map(t => `${t.abbrev} ${t.chopProbability}%`).join(", ")}.`);
