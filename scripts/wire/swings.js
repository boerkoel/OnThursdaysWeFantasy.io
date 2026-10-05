import { round } from "../lib/simulation.js";
import { currentWeek, liveScoreboard, money, possessive } from "./context.js";

// League Wire: win-odds swings (heart attack games, momentum, comebacks).
export function addSwingStories(add, matchupStates) {
  const history = Number(liveScoreboard.winHistory?.week) === currentWeek ? liveScoreboard.winHistory.points || [] : [];
  if (history.length < 3) return;
  const oddsOf = id => history.map(pt => Number(pt.p?.[id])).filter(Number.isFinite);
  const comebacks = [];
  const swingers = [];
  for (const x of matchupStates) {
    for (const [team, opp] of [[x.a, x.b], [x.b, x.a]]) {
      const series = oddsOf(team.teamId);
      const now = series[series.length - 1];
      const low = Math.min(...series);
      if (low <= 25 && now >= 60) comebacks.push({ team, opp, low, now });
    }
    // A flip counts only when the favorite clearly changes (past 55%), so
    // small wobbles around a coin flip don't register.
    let favorite = null;
    let flips = 0;
    for (const p of oddsOf(x.a.teamId)) {
      const side = p > 55 ? "a" : p < 45 ? "b" : favorite;
      if (favorite && side !== favorite) flips++;
      favorite = side;
    }
    if (flips >= 3) swingers.push({ x, flips });
  }
  const wildest = swingers.sort((a, b) => b.flips - a.flips)[0];
  if (wildest) {
    add("HEART ATTACK GAME","💓 HEART ATTACK GAME: the favorite in " + wildest.x.a.team + " vs " + wildest.x.b.team + " has flipped " + wildest.flips + " times this week.",70 + wildest.flips);
  }
  // Momentum shift: the biggest recent swing, comparing now with roughly half
  // an hour ago (the most recent snapshot at least 25 minutes old).
  const MOMENTUM_WINDOW_MS = 25 * 60 * 1000;
  const MOMENTUM_SWING = 20;
  const latest = history[history.length - 1];
  const earlier = [...history].reverse().find(pt => Date.parse(latest.t) - Date.parse(pt.t) >= MOMENTUM_WINDOW_MS);
  if (earlier) {
    const swings = matchupStates.filter(x => !x.m.completed).flatMap(x => [[x.a, x.b], [x.b, x.a]].map(([team, opp]) => ({
      team, opp,
      before: Number(earlier.p?.[team.teamId]),
      after: Number(latest.p?.[team.teamId])
    }))).filter(s => Number.isFinite(s.before) && Number.isFinite(s.after) && s.after - s.before >= MOMENTUM_SWING);
    const biggest = swings.sort((a, b) => (b.after - b.before) - (a.after - a.before))[0];
    if (biggest) {
      const minutes = Math.round((Date.parse(latest.t) - Date.parse(earlier.t)) / 60000);
      add("MOMENTUM SHIFT","⚡ MOMENTUM SHIFT: " + possessive(biggest.team.team) + " win odds against " + biggest.opp.team + " jumped from " + money(biggest.before) + "% to " + money(biggest.after) + "% in the last " + minutes + " minutes.",88 + (biggest.after - biggest.before) / 10);
    }
  }

  const best = comebacks.sort((a, b) => a.low - b.low)[0];
  if (best) {
    add("COMEBACK","📈 COMEBACK: " + best.team.team + " was down to " + money(best.low) + "% against " + best.opp.team + (best.now >= 100 ? " — and won." : " — now " + money(best.now) + "% to win."),best.now >= 100 ? 94 : 86);
  }
}
