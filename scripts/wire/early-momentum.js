import { DATA, clockNow, currentWeek, fit, listNames, liveScoreboard, liveTeams, money, name, pct, pts, readJson } from "./context.js";

// League Wire: early edges and the biggest play.
// ---- Early momentum ---------------------------------------------------------
// Early in the week (most starters yet to play): the matchup whose win odds
// have moved most since the week began, and who moved them. Plus the single
// play that swung a matchup the most in the last 45 minutes.
export const EARLY_SHARE_PLAYED = 0.4;
// Last name, except defenses keep their team ("Steelers D/ST", not "D/ST").
export const shortName = p => /D\/ST/.test(p.lastName) ? p.name : p.lastName;
export const EARLY_MIN_SWING = 5;
export const BIG_PLAY_WINDOW_MS = 45 * 60 * 1000;
export const BIG_PLAY_MIN_SHIFT = 4;
export const livePlayFeed = await readJson(`${DATA}/live-plays.json`).catch(() => null);
export function addEarlyMomentumStories(add, matchupStates) {
  const starters = [...liveTeams.values()].flatMap(t => t.players).filter(p => !p.bench);
  const started = starters.filter(p => p.game && p.game.state !== "pre");
  const history = Number(liveScoreboard.winHistory?.week) === currentWeek ? liveScoreboard.winHistory.points || [] : [];
  if (started.length && starters.length && started.length / starters.length <= EARLY_SHARE_PLAYED && history.length >= 2) {
    const baseline = history[0], latest = history[history.length - 1];
    const movers = matchupStates.flatMap(x => [[x.a, x.b], [x.b, x.a]]).map(([team, opp]) => ({
      team, opp, before:Number(baseline.p?.[team.teamId]), after:Number(latest.p?.[team.teamId])
    })).filter(m => Number.isFinite(m.before) && Number.isFinite(m.after) && m.after - m.before >= EARLY_MIN_SWING)
      .sort((a, b) => (b.after - b.before) - (a.after - a.before));
    const best = movers[0];
    if (best) {
      const leader = started.filter(p => p.teamId === best.team.teamId).sort((a, b) => b.actual - a.actual)[0];
      const by = leader && leader.actual > 0 ? ", led by " + shortName(leader) + " (" + pts(leader.actual) + ")" : "";
      const others = movers.slice(1, 3).filter(m => m.team.teamId !== best.opp.teamId);
      add("EARLY EDGE",fit(
        "⚡ Early edge: " + best.team.team + " went from " + pct(best.before) + " to " + pct(best.after) + " against " + best.opp.team + by + "." + (others.length ? " Also up: " + listNames(others.map(m => m.team.team + " (+" + money(m.after - m.before) + ")")) + "." : ""),
        "⚡ Early edge: " + best.team.team + " went from " + pct(best.before) + " to " + pct(best.after) + " against " + best.opp.team + by + ".",
        "⚡ Early edge: " + best.team.team + " is up to " + pct(best.after) + " against " + best.opp.team + by + "."
      ),80 + (best.after - best.before) / 10);
    }
  }

  const bigPlay = (Number(livePlayFeed?.week) === currentWeek ? livePlayFeed.plays || [] : [])
    .filter(p => p.momentum?.shift >= BIG_PLAY_MIN_SHIFT && p.wallclock && clockNow() - Date.parse(p.wallclock) <= BIG_PLAY_WINDOW_MS)
    .sort((a, b) => b.momentum.shift - a.momentum.shift)[0];
  if (bigPlay) {
    const team = name(Number(bigPlay.fantasyTeamId));
    const sign = bigPlay.points > 0 ? "+" : "";
    add("BIGGEST PLAY",fit(
      "💥 Biggest play: " + bigPlay.player + " (" + sign + pts(bigPlay.points) + " for " + team + ") swung the odds " + pct(bigPlay.momentum.shift) + " toward " + bigPlay.momentum.toward + ", now " + pct(bigPlay.momentum.winProbability) + ".",
      "💥 Biggest play: " + bigPlay.player + " (" + sign + pts(bigPlay.points) + ") swung the odds " + pct(bigPlay.momentum.shift) + " toward " + bigPlay.momentum.toward + "."
    ),84 + bigPlay.momentum.shift / 5);
  }
}
