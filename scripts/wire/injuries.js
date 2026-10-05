import { normalCdf, normalQuantile } from "../lib/simulation.js";
import { clockNow, currentScores, currentWeek, fit, guillotineData, liveTeams, money, name, pct, surname } from "./context.js";
import { livePlayFeed } from "./early-momentum.js";

// League Wire: mid-game injury alerts.
// ---- Injury alerts -----------------------------------------------------------
// A starter hurt mid-game (from ESPN's play-by-play injury updates): what his
// team's odds become if he doesn't return. Main league: win odds against the
// opponent. Guillotine: chop odds. Quiet once he's back in.
export const INJURY_STATUS_TEXT = { injured: "went down injured", questionable: "is questionable to return", doubtful: "is doubtful to return", out: "is out for the game" };
export const INJURY_MIN_SWING = 3;
export const INJURY_MAX_AGE_MS = 3 * 60 * 60 * 1000;
export function addInjuryStories(add) {
  if (Number(livePlayFeed?.week) !== currentWeek) return;
  const latest = new Map();
  for (const i of livePlayFeed.injuries || []) {
    const key = i.league + "|" + i.playerId + "|" + i.teamId;
    if (!latest.has(key) || Date.parse(i.wallclock) > Date.parse(latest.get(key).wallclock)) latest.set(key, i);
  }
  const clamp = p => Math.min(0.9999, Math.max(0.0001, p));
  const candidates = [];
  for (const i of latest.values()) {
    if (!INJURY_STATUS_TEXT[i.status] || !i.wallclock || clockNow() - Date.parse(i.wallclock) > INJURY_MAX_AGE_MS) continue;
    const who = surname(i.player);
    if (i.league === "main") {
      const team = currentScores.find(s => s.teamId === Number(i.teamId));
      const opp = team && currentScores.find(s => s.teamId === Number(team.opponentId));
      const player = (liveTeams.get(Number(i.teamId))?.players || []).find(p => p.playerId === Number(i.playerId));
      if (!team || !opp || !player || player.bench || player.finished) continue;
      const rest = Math.max(0, (player.projection ?? 0) - player.actual);
      const odds = Number(team.winProbability);
      if (!rest || !(odds > 0 && odds < 100)) continue;
      const sd = Math.max(3, Math.hypot(Number(team.projectionSd) || 0, Number(opp.projectionSd) || 0));
      const done = 100 * normalCdf(normalQuantile(clamp(odds / 100)) - rest / sd);
      if (odds - done < INJURY_MIN_SWING) continue;
      candidates.push({type:"INJURY ALERT", swing:odds - done, text:fit(
        "🚑 INJURY ALERT: " + i.player + " " + INJURY_STATUS_TEXT[i.status] + " for " + team.team + ". If he's done, their odds against " + opp.team + " fall from " + pct(odds) + " to " + pct(done) + ".",
        "🚑 INJURY ALERT: " + who + " " + INJURY_STATUS_TEXT[i.status] + " for " + team.team + " — " + pct(odds) + " → " + pct(done) + " vs " + opp.team + " if he's done."
      )});
    } else if (Number(guillotineData?.week) === currentWeek) {
      const team = (guillotineData.teams || []).find(t => t.teamId === Number(i.teamId));
      const player = (team?.remaining || []).find(p => p.name === i.player);
      const chop = Number(team?.chopProbability);
      if (!team || !player?.projectedRest || !(chop > 0 && chop < 100)) continue;
      const sds = (guillotineData.teams || []).map(t => Number(t.projectionSd) || 0).sort((a, b) => a - b);
      const sd = Math.max(3, Math.hypot(Number(team.projectionSd) || 0, sds[Math.floor(sds.length / 2)] || 0));
      const done = 100 * normalCdf(normalQuantile(clamp(chop / 100)) + player.projectedRest / sd);
      if (done - chop < INJURY_MIN_SWING) continue;
      candidates.push({type:"DEATH WATCH INJURY", swing:done - chop, text:fit(
        "🚑🪓 " + i.player + " " + INJURY_STATUS_TEXT[i.status] + " for " + team.team + ". If he's done, their chop odds jump from " + pct(chop) + " to " + pct(done) + ".",
        "🚑🪓 " + who + " " + INJURY_STATUS_TEXT[i.status] + " for " + team.team + ": chop odds " + pct(chop) + " → " + pct(done) + " if he's done."
      )});
    }
  }
  candidates.sort((a, b) => b.swing - a.swing).slice(0, 2).forEach(c => add(c.type, c.text, 90 + Math.min(c.swing, 30) / 5));
}
