import { DATA, clockNow, currentScores, currentWeek, fit, listNames, liveScoreboard, liveTeams, money, name, pct, pts, readJson, seasonOddsData } from "./context.js";
import { shortPlay } from "../../src/lib/playText.js";

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

  // A play that flipped two wins each way (Jim, 2026-11-16: "the catch by Andrews just crashed Ruffing's playoff
  // odds by X while skyrocketing Stacey's by Y"): it put its team ahead of its opponent and, with the two straddling
  // the median line, above the median while the opponent fell below. Playoff odds with 2 wins vs 0 this week
  // (season-odds.js byWins), as scores stand; shown when the two move 20+ points combined.
  const medianOf = v => { const x = [...v].sort((a, b) => a - b), n = x.length; return n % 2 ? x[(n - 1) / 2] : (x[n / 2 - 1] + x[n / 2]) / 2; };
  const scoreOf = new Map(currentScores.map(s => [Number(s.teamId), Number(s.score)]));
  const byWins = (id, wins) => Number(seasonOddsData?.byWins?.[String(id)]?.[wins]?.playoffOdds);
  const flips = (Number(livePlayFeed?.week) === currentWeek ? livePlayFeed.plays || [] : [])
    .filter(p => Number(p.points) > 0 && p.wallclock && clockNow() - Date.parse(p.wallclock) <= BIG_PLAY_WINDOW_MS)
    .map(p => {
      const t = currentScores.find(s => Number(s.teamId) === Number(p.fantasyTeamId));
      const o = t && currentScores.find(s => Number(s.teamId) === Number(t.opponentId));
      if (!t || !o || scoreOf.size < 4) return null;
      const now = Number(t.score), before = now - Number(p.points), opp = Number(o.score);
      const medNow = medianOf([...scoreOf.values()]), medBefore = medianOf([...scoreOf.entries()].map(([id, v]) => id === Number(t.teamId) ? before : v));
      const flipped = before <= opp && now > opp && before <= medBefore && opp > medBefore && now > medNow && opp <= medNow;
      const odds = { t0: byWins(t.teamId, 0), t2: byWins(t.teamId, 2), o0: byWins(o.teamId, 0), o2: byWins(o.teamId, 2) };
      if (!flipped || !Object.values(odds).every(Number.isFinite)) return null;
      return { p, t, o, ...odds, swing: (odds.t2 - odds.t0) + (odds.o2 - odds.o0) };
    }).filter(x => x && x.swing >= 20).sort((a, b) => b.swing - a.swing);
  const f = flips[0];
  if (f) {
    const r = n => Math.round(n) + "%";
    const play = shortPlay(f.p) || "big play";
    add("TWO-WIN PLAY", fit(
      "🚀 TWO-WIN PLAY: " + f.p.player + "'s " + play + " (+" + pts(f.p.points) + ") beat " + f.o.team + " and the median at once. It skyrocketed " + f.t.team + "'s playoff odds from " + r(f.t0) + " to " + r(f.t2) + " and crashed " + f.o.team + "'s from " + r(f.o2) + " to " + r(f.o0) + ".",
      "🚀 TWO-WIN PLAY: " + f.p.player + " (+" + pts(f.p.points) + ") skyrocketed " + f.t.team + "'s playoff odds " + r(f.t0) + " → " + r(f.t2) + " and crashed " + f.o.team + "'s " + r(f.o2) + " → " + r(f.o0) + "."
    ), 92 + f.swing / 20);
  }
}
