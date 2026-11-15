import { injuryShareFn, normalCdf, normalQuantile } from "../lib/simulation.js";
import { clockNow, currentScores, currentWeek, fit, guillotineData, listNames, liveScoreboard, liveTeams, money, name, pct, surname } from "./context.js";
import { livePlayFeed } from "./early-momentum.js";

// League Wire: mid-game injury alerts.
// ---- Injury alerts -----------------------------------------------------------
// A starter hurt mid-game (from ESPN's play-by-play injury updates): what his
// team's odds become if he doesn't return. Main league: win odds against the
// opponent. Guillotine: chop odds. Quiet once he's back in.
// Since 2026-11-15 the live odds already count only part of a hurt player's remaining points (simulation.js
// injuryShareFn), so "if he's done" moves only the part still counted; once he's ruled out (ESPN's OUT or a
// "ruled out" note) the story reports the move that happened, odds before he went down → now (Jim: "Brock X → Y"),
// and INJURY RIPPLE names the league's starters on his NFL team who lose out (a QB's pass catchers).
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
  const share = injuryShareFn(livePlayFeed, currentWeek, "main", clockNow());
  const history = Number(liveScoreboard.winHistory?.week) === currentWeek ? liveScoreboard.winHistory.points || [] : [];
  const candidates = [], ripples = [];
  for (const i of latest.values()) {
    if (!INJURY_STATUS_TEXT[i.status] || i.returnedAt || !i.wallclock || clockNow() - Date.parse(i.wallclock) > INJURY_MAX_AGE_MS) continue;
    const who = surname(i.player);
    if (i.league === "main") {
      const team = currentScores.find(s => s.teamId === Number(i.teamId));
      const opp = team && currentScores.find(s => s.teamId === Number(team.opponentId));
      const player = (liveTeams.get(Number(i.teamId))?.players || []).find(p => p.playerId === Number(i.playerId));
      if (!team || !opp || !player || player.bench || player.finished) continue;
      const kept = share({ id: player.playerId, injuryStatus: player.injuryStatus });
      const odds = Number(team.winProbability);
      if (kept === 0) {
        // ruled out: the odds already moved; report it from the last update before he went down
        const before = Number(history.filter(h => Date.parse(h.t) <= Date.parse(i.wallclock)).at(-1)?.p?.[team.teamId]);
        ripples.push({ player, team: team.team, pos: player.positionId, proTeamId: player.proTeamId });
        if (!Number.isFinite(before) || before - odds < INJURY_MIN_SWING) continue;
        candidates.push({type:"INJURY ALERT", swing:before - odds, text:fit(
          "🚑 OUT: " + i.player + " is done for the day, and " + team.team + "'s odds against " + opp.team + " went from " + pct(before) + " to " + pct(odds) + ".",
          "🚑 OUT: " + who + " is done. " + team.team + ": " + pct(before) + " → " + pct(odds) + " vs " + opp.team + "."
        )});
        continue;
      }
      const rest = Math.max(0, (player.projection ?? 0) - player.actual) * kept;
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
      // projectedRest is already cut for the injury; ruled out leaves nothing to fork over
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
  addRipples(add, ripples);
}

// 🚑 INJURY RIPPLE: the league's starters (both leagues) on a ruled-out player's NFL team, still playing, who lose
// out: a QB's pass catchers (now with a backup). Other positions' teammates pick up work, so they're left alone.
const PASS_CATCHERS = new Set([3, 4]);   // WR, TE
const GUILLOTINE_POS = new Set(["WR", "TE"]);
function addRipples(add, ripples) {
  for (const r of ripples.filter(r => r.pos === 1).slice(0, 1)) {
    const main = [...liveTeams.values()].flatMap(t => t.players).filter(p => !p.bench && p.playing && p.proTeamId === r.proTeamId && PASS_CATCHERS.has(p.positionId))
      .map(p => ({ name: surname(p.name), team: name(p.teamId) }));
    const chop = Number(guillotineData?.week) === currentWeek ? (guillotineData.teams || []).flatMap(t => (t.lineup || [])
      .filter(p => Number(p.proTeamId) === r.proTeamId && GUILLOTINE_POS.has(p.pos)).map(p => ({ name: surname(p.name), team: "🪓 " + t.team }))) : [];
    const hit = [...main, ...chop];
    if (!hit.length) continue;
    const byTeam = new Map();
    for (const h of hit) byTeam.set(h.team, [...(byTeam.get(h.team) || []), h.name]);
    const list = [...byTeam].map(([team, names]) => listNames(names) + " (" + team + ")");
    add("INJURY RIPPLE", fit(
      "🚑 " + surname(r.player.name) + "'s exit hits more than " + r.team + ": " + listNames(list) + " now catch passes from a backup.",
      "🚑 " + surname(r.player.name) + "'s exit also hits " + listNames(list) + ": a backup QB now.",
      "🚑 " + surname(r.player.name) + " out: " + hit.length + " more league starters now have a backup QB."
    ), 88);
  }
}
