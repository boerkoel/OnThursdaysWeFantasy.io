import { readFile, writeFile } from "node:fs/promises";
import { SIMULATIONS, gameScriptInputs, playerOutlook, possibleOdds, round, scoreRange, seededRng, simulateFinal } from "./lib/simulation.js";

// Death Watch for the companion guillotine league (public on ESPN, so no
// cookies are needed): each week the lowest-scoring surviving team is
// chopped. Simulates the rest of the week to estimate each team's odds of
// finishing last.
const season = process.env.ESPN_SEASON || "2026";
const leagueId = process.env.GUILLOTINE_LEAGUE_ID || "687798070";
const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`;

// The league agreed to start in week 2; week 1's chop was a placeholder team.
const FIRST_REAL_WEEK = Number(process.env.GUILLOTINE_FIRST_WEEK || 2);
const BENCH_SLOT = 20;
const IR_SLOT = 21;

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
  const game = { name: event.shortName || "", completed: status?.completed === true || status?.state === "post", ...gameScriptInputs(competition) };
  for (const c of competition?.competitors || []) nflGameByProTeam.set(Number(c.team?.id), game);
}

const weeklyStat = (player, statSourceId) => Number((player?.stats || []).find(s =>
  Number(s.scoringPeriodId) === week && Number(s.statSourceId) === statSourceId && Number(s.statSplitTypeId) === 1
)?.appliedTotal);

// Logos cached into the site by cache-team-logos.js; ESPN's stock logos can
// also be linked directly, but custom uploads can't.
const logoMap = await readFile("data/current/guillotine-logo-map.json", "utf8").then(JSON.parse).catch(() => ({}));
const logoFor = t => logoMap[String(t.id)] || (String(t.logo || "").startsWith("https://g.espncdn.com/") ? t.logo : null);
const teamInfo = new Map((league.teams || []).map(t => [Number(t.id), { name: (t.name || `Team ${t.id}`).trim(), abbrev: t.abbrev || "", logo: logoFor(t) }]));
const weekEntry = (scores.schedule || []).find(g => Number(g.matchupPeriodId) === week);
const scoreByTeam = new Map((weekEntry?.teams || []).map(t => [Number(t.teamId), t]));
const rosterByTeam = new Map((rosters.teams || []).map(t => [Number(t.id), t.roster?.entries || []]));

// eliminationMatchupPeriod is 0 while a team is alive, else the week it was
// chopped. For the RIP section, record each chopped team's final score, the
// team it fell short of, and its date of death (that week's last NFL game).
// Death dates are fetched once and then reused from the previous file.
const previous = await readFile("data/current/guillotine.json", "utf8").then(JSON.parse).catch(() => null);
const previousChopped = new Map((previous?.chopped || []).map(c => [Number(c.teamId), c]));
async function lastGameDate(chopWeek) {
  const nfl = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${chopWeek}&seasontype=2&season=${season}`).catch(() => null);
  const dates = (nfl?.events || []).map(e => Date.parse(e.date)).filter(Number.isFinite);
  return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
}
const chopped = [];
for (const t of weekEntry?.teams || []) {
  const chopWeek = Number(t.eliminationMatchupPeriod);
  if (!(chopWeek >= FIRST_REAL_WEEK)) continue;
  const teamId = Number(t.teamId);
  const thatWeek = (scores.schedule || []).find(g => Number(g.matchupPeriodId) === chopWeek)?.teams || [];
  const finalScore = round(Number(thatWeek.find(x => Number(x.teamId) === teamId)?.totalPoints ?? 0));
  // Teams still alive that week, other than this one, sorted low to high.
  const survivors = thatWeek
    .filter(x => Number(x.teamId) !== teamId && !(Number(x.eliminationMatchupPeriod) > 0 && Number(x.eliminationMatchupPeriod) < chopWeek))
    .sort((a, b) => Number(a.totalPoints) - Number(b.totalPoints));
  const nextLowest = survivors[0];
  const prior = previousChopped.get(teamId);
  chopped.push({
    teamId,
    team: teamInfo.get(teamId)?.name || `Team ${teamId}`,
    logo: teamInfo.get(teamId)?.logo || null,
    week: chopWeek,
    finalScore,
    survivedBy: nextLowest ? { team: teamInfo.get(Number(nextLowest.teamId))?.name, score: round(Number(nextLowest.totalPoints)) } : null,
    margin: nextLowest ? round(Number(nextLowest.totalPoints) - finalScore) : null,
    diedOn: prior?.week === chopWeek && prior.diedOn ? prior.diedOn : await lastGameDate(chopWeek)
  });
}
chopped.sort((a, b) => b.week - a.week);
const draftDate = league.settings?.draftSettings?.date ? new Date(league.settings.draftSettings.date).toISOString() : null;

// Each team's starters for the Death Watch cards' lineup expander, in the
// same shape as the main league's matchup lineups (scoreboard.json).
const POSITIONS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };
const INJURY_SHORT = { QUESTIONABLE: "Q", DOUBTFUL: "D", OUT: "O", INJURY_RESERVE: "IR", SUSPENSION: "SSPD" };
const shortName = player => /D\/ST/.test(player.fullName) ? player.fullName : (player.firstName ? player.firstName[0] + ". " : "") + (player.lastName || player.fullName);

const alive = [...scoreByTeam.values()]
  .filter(t => Number(t.eliminationMatchupPeriod) === 0)
  .map(t => {
    const teamId = Number(t.teamId);
    const remaining = [];
    const lineup = [];
    for (const entry of rosterByTeam.get(teamId) || []) {
      const slot = Number(entry.lineupSlotId);
      const player = entry.playerPoolEntry?.player;
      if (slot === BENCH_SLOT || slot === IR_SLOT || !player) continue;
      const weekActual = weeklyStat(player, 0), weekProjection = weeklyStat(player, 1);
      lineup.push({ id: Number(entry.playerId), name: shortName(player), pos: POSITIONS[Number(player.defaultPositionId)] || "", proTeamId: Number(player.proTeamId), slot,
        actual: Number.isFinite(weekActual) ? round(weekActual) : 0, projection: Number.isFinite(weekProjection) ? round(weekProjection) : null,
        injury: INJURY_SHORT[player.injuryStatus] || null });
      const game = nflGameByProTeam.get(Number(player.proTeamId));
      // Bye weeks (no game) and finished games have nothing left to add.
      if (nflWeek && (!game || game.completed)) continue;
      const actual = Number.isFinite(weeklyStat(player, 0)) ? weeklyStat(player, 0) : 0;
      const projection = weeklyStat(player, 1);
      remaining.push({ name: player.fullName, game: game?.name || "", actual: round(actual), ...playerOutlook({ actual, projection, positionId: player.defaultPositionId, game, proTeamId: player.proTeamId }) });
    }
    const score = round(Number(t.totalPointsLive ?? t.totalPoints ?? 0));
    return {
      teamId,
      team: teamInfo.get(teamId)?.name || `Team ${teamId}`,
      abbrev: teamInfo.get(teamId)?.abbrev || "",
      logo: teamInfo.get(teamId)?.logo || null,
      score,
      projected: round(score + remaining.reduce((sum, p) => sum + p.rest, 0)),
      // Spread of the final score, for estimating how much one play moves the chop odds.
      projectionSd: round(Math.hypot(...remaining.map(p => p.sd))),
      remaining,
      lineup
    };
  });

// Besides chop odds, each simulation tallies, per team:
// - for each player still to play, chops when he beats his projection and
//   when he doesn't (to find the player whose game matters most), and
// - in the simulations where the team is chopped, who finished just above it
//   (the team it's really racing).
const rng = seededRng(alive.map(t => [t.teamId, t.score, t.projected]));
const chopCounts = new Map(alive.map(t => [t.teamId, 0]));
const playerTallies = new Map(alive.map(t => [t.teamId, t.remaining.map(() => ({ above: 0, choppedAbove: 0, choppedBelow: 0, pointsAbove: 0, pointsBelow: 0 }))]));
const escapedBy = new Map(alive.map(t => [t.teamId, new Map()]));
// The same split for each NFL game: all of a team's starters in it together.
const gameTallies = new Map(alive.map(t => {
  const groups = new Map();
  t.remaining.forEach((p, i) => { if (p.game) groups.set(p.game, [...(groups.get(p.game) || []), i]); });
  return [t.teamId, [...groups].map(([game, players]) => ({ game, players, rest: players.reduce((sum, i) => sum + t.remaining[i].rest, 0), above: 0, choppedAbove: 0, choppedBelow: 0, pointsAbove: 0, pointsBelow: 0 }))];
}));
const playerPoints = new Map(alive.map(t => [t.teamId, new Array(t.remaining.length)]));
for (let sim = 0; sim < SIMULATIONS; sim++) {
  const finals = alive.map(t => ({ teamId: t.teamId, score: simulateFinal({ score: t.score, players: t.remaining }, rng, playerPoints.get(t.teamId)) }));
  const lowest = Math.min(...finals.map(f => f.score));
  const last = finals.filter(f => f.score === lowest);
  for (const f of last) chopCounts.set(f.teamId, chopCounts.get(f.teamId) + 1 / last.length);
  const nextUp = last.length === 1 ? finals.filter(f => f.score > lowest).sort((a, b) => a.score - b.score)[0] : null;
  if (nextUp) { const m = escapedBy.get(last[0].teamId); m.set(nextUp.teamId, (m.get(nextUp.teamId) || 0) + 1); }
  for (const t of alive) {
    const chopped = last.some(f => f.teamId === t.teamId) ? 1 / last.length : 0;
    const points = playerPoints.get(t.teamId);
    t.remaining.forEach((p, i) => {
      const tally = playerTallies.get(t.teamId)[i];
      if (points[i] >= p.rest) { tally.above++; tally.choppedAbove += chopped; tally.pointsAbove += points[i]; }
      else { tally.choppedBelow += chopped; tally.pointsBelow += points[i]; }
    });
    for (const g of gameTallies.get(t.teamId)) {
      const total = g.players.reduce((sum, i) => sum + points[i], 0);
      if (total >= g.rest) { g.above++; g.choppedAbove += chopped; g.pointsAbove += total; }
      else { g.choppedBelow += chopped; g.pointsBelow += total; }
    }
  }
}

// Exact 0%/100% only when locked, judged from each team's lowest and highest
// possible final score (players can lose points); otherwise possibleOdds.
const rangeOf = t => scoreRange({ score: t.score, players: t.remaining });
for (const t of alive) {
  const me = rangeOf(t);
  const others = alive.filter(o => o.teamId !== t.teamId).map(rangeOf);
  const surelySafe = others.some(o => o.max < me.min);
  const surelyChopped = others.every(o => o.min > me.max);
  t.chopProbability = surelySafe ? 0 : surelyChopped ? 100 : possibleOdds(chopCounts.get(t.teamId));
}
// The swing player: the one whose beating his projection or not moves the
// team's chop odds most (with enough simulations on both sides to trust it).
// The rival: who most often finished just above the team when it was chopped.
const MIN_SIDE_SIMULATIONS = 500;
for (const t of alive) {
  if (t.chopProbability <= 0 || t.chopProbability >= 100) continue;
  const swing = t.remaining.map((p, i) => {
    const { above, choppedAbove, choppedBelow, pointsAbove, pointsBelow } = playerTallies.get(t.teamId)[i];
    const below = SIMULATIONS - above;
    if (above < MIN_SIDE_SIMULATIONS || below < MIN_SIDE_SIMULATIONS) return null;
    return { name: p.name, game: p.game, projectedRest: round(p.rest), chopIfAbove: round(100 * choppedAbove / above), chopIfBelow: round(100 * choppedBelow / below),
      // His typical total in each half: a big game vs a quiet one.
      bigGame: round(p.actual + pointsAbove / above), quietGame: round(p.actual + pointsBelow / below) };
  }).filter(Boolean).sort((a, b) => (b.chopIfBelow - b.chopIfAbove) - (a.chopIfBelow - a.chopIfAbove))[0];
  if (swing && swing.chopIfBelow - swing.chopIfAbove >= 1) t.swingPlayer = swing;
  // Each NFL game's swing (biggest first, top 3, for the League Wire), and
  // the swing game: the biggest one with 2+ of the team's starters in it.
  const games = gameTallies.get(t.teamId).map(g => {
    const below = SIMULATIONS - g.above;
    if (g.above < MIN_SIDE_SIMULATIONS || below < MIN_SIDE_SIMULATIONS) return null;
    const actual = g.players.reduce((sum, i) => sum + t.remaining[i].actual, 0);
    return { game: g.game, players: g.players.map(i => t.remaining[i].name), projectedRest: round(g.rest),
      chopIfAbove: round(100 * g.choppedAbove / g.above), chopIfBelow: round(100 * g.choppedBelow / below),
      bigGame: round(actual + g.pointsAbove / g.above), quietGame: round(actual + g.pointsBelow / below) };
  }).filter(g => g && g.chopIfBelow - g.chopIfAbove >= 1).sort((a, b) => (b.chopIfBelow - b.chopIfAbove) - (a.chopIfBelow - a.chopIfAbove));
  if (games.length) t.gameSwings = games.slice(0, 3);
  const swingGame = games.find(g => g.players.length >= 2);
  if (swingGame) t.swingGame = swingGame;
  const chops = [...escapedBy.get(t.teamId).values()].reduce((a, b) => a + b, 0);
  const [rivalId, count] = [...escapedBy.get(t.teamId).entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (rivalId != null && chops >= MIN_SIDE_SIMULATIONS / 5) {
    const rival = alive.find(o => o.teamId === rivalId);
    t.rival = { teamId: rivalId, team: rival.team, share: round(100 * count / chops) };
  }
}
for (const t of alive) {
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

// Chop-odds history for the Death Watch chart: one snapshot per update while
// the odds are moving, thinned out if it gets long (like the main league's
// win-odds history).
const MAX_CHOP_HISTORY = 400;
let chopHistory = Number(previous?.chopHistory?.week) === week ? [...(previous.chopHistory.points || [])] : [];
const snapshot = { t: new Date().toISOString(), p: Object.fromEntries(alive.map(t => [t.teamId, t.chopProbability])) };
const lastSnapshot = chopHistory[chopHistory.length - 1];
if (!lastSnapshot || Object.entries(snapshot.p).some(([id, p]) => lastSnapshot.p?.[id] !== p)) chopHistory.push(snapshot);
if (chopHistory.length > MAX_CHOP_HISTORY) chopHistory = chopHistory.filter((_, i) => i % 2 === 0 || i >= chopHistory.length - 100);

await writeFile("data/current/guillotine.json", JSON.stringify({
  leagueId,
  leagueName: league.settings?.name || "Guillotine League",
  draftDate,
  week,
  lastUpdated: new Date().toISOString(),
  simulations: SIMULATIONS,
  teams: alive,
  chopped,
  chopHistory: { week, points: chopHistory }
}, null, 2) + "\n");

console.log(`Guillotine week ${week}: ${alive.length} teams alive; most at risk: ${alive.slice(0, 3).map(t => `${t.abbrev} ${t.chopProbability}%`).join(", ")}.`);
