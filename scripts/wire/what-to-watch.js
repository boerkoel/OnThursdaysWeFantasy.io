import { playerOutlook, round, swingOdds } from "../lib/simulation.js";
import { clockNow, currentScores, fit, guillotineData, listNames, liveTeams, money, name, nflGames, possessive, pts } from "./context.js";
import { shortName } from "./early-momentum.js";

// League Wire: what to watch next and the game to watch.
// ---- What to watch ---------------------------------------------------------
// Between games: the next kickoff slot (games starting within half an hour of
// the first one), which league starters play in it, and what's riding on it.
export const SLOT_SPREAD_MS = 30 * 60 * 1000;
export const WATCH_AHEAD_MS = 36 * 60 * 60 * 1000;
export const kickoffLabel = iso => {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", {weekday:"long", timeZone:"America/New_York"});
  const time = d.toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit", timeZone:"America/New_York"}).replace(":00", "");
  return day + " " + time;
};
export function addWhatToWatchStories(add, matchupStates) {
  if (nflGames.some(g => g.state === "in")) return;
  const upcoming = nflGames.filter(g => g.state === "pre" && g.kickoff).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  if (!upcoming.length) return;
  const first = Date.parse(upcoming[0].kickoff);
  if (first - clockNow() > WATCH_AHEAD_MS) return;
  const slot = new Set(upcoming.filter(g => Date.parse(g.kickoff) - first <= SLOT_SPREAD_MS).map(g => g.id));
  const inSlot = teamId => (liveTeams.get(teamId)?.players || []).filter(p => !p.bench && p.game && slot.has(p.game.id));
  const when = kickoffLabel(upcoming[0].kickoff) + (slot.size === 1 ? " (" + upcoming[0].name + ")" : "");

  const stakes = matchupStates.filter(x => !x.m.completed).map(x => {
    const players = [...inSlot(x.a.teamId), ...inSlot(x.b.teamId)];
    const projected = round(players.reduce((sum, p) => sum + (p.projection ?? 0), 0));
    const odds = Number(x.a.winProbability);
    return {x, players, projected, closeness:Number.isFinite(odds) ? 1 - Math.abs(odds - 50) / 50 : 0.5};
  }).filter(m => m.players.length);
  const starters = stakes.reduce((n, m) => n + m.players.length, 0);
  if (!starters) return;
  const top = [...stakes].sort((a, b) => b.projected - a.projected)[0];
  const startsFor = teamId => { const ps = inSlot(teamId); return ps.length ? listNames(ps.map(shortName)) + " for " + name(teamId) : null; };
  const lineups = [...new Set(stakes.flatMap(m => [m.x.a.teamId, m.x.b.teamId]))].map(startsFor).filter(Boolean);
  add("WHAT TO WATCH",fit(
    "📺 Up next, " + when + ": " + lineups.join("; ") + ".",
    "📺 Up next, " + when + ": " + starters + " league starters in action. Most riding on it: " + top.x.a.team + " vs " + top.x.b.team + " (" + pts(top.projected) + " projected).",
    "📺 Up next, " + when + ": " + starters + " league starters, led by " + top.x.a.team + " vs " + top.x.b.team + ".",
    "📺 Up next, " + when + ": " + starters + " league starters in action."
  ),76);

  // The starter whose game matters most: a big projection in a close matchup.
  const swing = stakes.flatMap(m => m.players.map(p => ({p, m, weight:(p.projection ?? 0) * m.closeness})))
    .sort((a, b) => b.weight - a.weight)[0];
  if (swing && swing.weight > 0) {
    const mine = name(swing.p.teamId), other = swing.p.teamId === swing.m.x.a.teamId ? swing.m.x.b : swing.m.x.a;
    const odds = Number(currentScores.find(s => s.teamId === swing.p.teamId)?.winProbability);
    add("PLAYER TO WATCH",fit(
      "🔭 Player to watch: " + swing.p.name + (swing.p.game ? " (" + swing.p.game.name + ")" : "") + ". ESPN projects " + pts(swing.p.projection ?? 0) + ", and " + mine + (Number.isFinite(odds) ? " is " + money(odds) + "%" : " is in a tight one") + " against " + other.team + ".",
      "🔭 Player to watch: " + shortName(swing.p) + ", with " + mine + (Number.isFinite(odds) ? " at " + money(odds) + "%" : "") + " against " + other.team + "."
    ),70);
  }
}

// ---- Game to watch ---------------------------------------------------------
// The NFL game (live, or kicking off within 36 hours) that could move the most
// odds: how far a big versus a quiet game from the league's starters in it
// swings each H2H matchup and each median race (normal approximation from
// the projections), plus the guillotine league's chop odds (from its
// simulations), added up.
export const GAME_WATCH_MIN_SWING = 15;
export function addGameToWatchStory(add, matchupStates) {
  const sdIn = (teamId, gameId) => Math.hypot(...(liveTeams.get(teamId)?.players || [])
    .filter(p => !p.bench && !p.finished && p.game?.id === gameId)
    .map(p => playerOutlook({actual:p.actual, projection:p.projection, positionId:p.positionId}).sd));
  const candidates = nflGames.filter(g => !g.completed && (g.state === "in" || (g.kickoff && Date.parse(g.kickoff) - clockNow() <= WATCH_AHEAD_MS)));
  const games = candidates.map(g => {
    const starters = [...liveTeams.values()].flatMap(t => t.players).filter(p => !p.bench && !p.finished && p.game?.id === g.id);
    const pointsLeft = round(starters.reduce((sum, p) => sum + Math.max(0, (p.projection ?? 0) - p.actual), 0));
    const h2h = matchupStates.filter(x => !x.m.completed).map(x => ({
      x, swing:swingOdds(x.a.winProbability, Math.hypot(sdIn(x.a.teamId, g.id), sdIn(x.b.teamId, g.id)), Math.hypot(Number(x.a.projectionSd) || 0, Number(x.b.projectionSd) || 0))
    })).sort((a, b) => b.swing - a.swing);
    const median = currentScores.map(s => ({s, swing:swingOdds(s.aboveMedianProbability, sdIn(s.teamId, g.id), Number(s.projectionSd))})).sort((a, b) => b.swing - a.swing);
    const chop = (guillotineData?.teams || []).map(t => {
      const gs = (t.gameSwings || []).find(x => x.game === g.name);
      return gs ? {t, swing:round(gs.chopIfBelow - gs.chopIfAbove)} : null;
    }).filter(Boolean).sort((a, b) => b.swing - a.swing);
    const total = [...h2h, ...median, ...chop].reduce((sum, x) => sum + x.swing, 0);
    return {g, starters, pointsLeft, h2h:h2h[0], median:median[0], chop:chop[0], total};
  }).filter(x => x.starters.length).sort((a, b) => b.total - a.total);
  const best = games[0];
  if (!best || Math.max(best.h2h?.swing || 0, best.median?.swing || 0, best.chop?.swing || 0) < GAME_WATCH_MIN_SWING) return;

  const when = best.g.state === "in" ? "live now" : kickoffLabel(best.g.kickoff);
  const stakes = [
    best.h2h?.swing >= GAME_WATCH_MIN_SWING ? best.h2h.x.a.team + " vs " + best.h2h.x.b.team + " by " + Math.round(best.h2h.swing) + "%" : null,
    best.median?.swing >= GAME_WATCH_MIN_SWING ? possessive(best.median.s.team) + " median odds by " + Math.round(best.median.swing) + "%" : null,
    best.chop?.swing >= 10 ? possessive(best.chop.t.team) + " chop odds by " + Math.round(best.chop.swing) + "%" : null
  ].filter(Boolean);
  const intro = "🏟️ Game to watch: " + best.g.name + " (" + when + "), " + best.starters.length + " league starters in action with " + pts(best.pointsLeft) + " up for grabs.";
  add("GAME TO WATCH",fit(
    intro + " It could swing " + listNames(stakes) + ".",
    intro + " It could swing " + listNames(stakes.slice(0, 2)) + ".",
    intro + " It could swing " + stakes[0] + ".",
    intro
  ),best.g.state === "in" ? 82 : 77);
}
