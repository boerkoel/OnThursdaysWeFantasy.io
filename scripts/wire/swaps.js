import { DATA, currentScores, currentWeek, fit, name, nflGameByProTeam, pts, readJson, surname, teamNames } from "./context.js";

// League Wire: manager miscues and shrewd swaps.
// ---- Manager miscue ----------------------------------------------------------
// From drops.json (fetch-drops.js), players dropped in the last week:
// - one having a big week (12+ points), or
// - one outscoring the player picked up in his place (by 3+, with 5+ points,
//   once both have played).
// The bigger miscue of the two gets the story. The positive version, SHREWD
// SWAP: the pickup outscoring the player he replaced (8+ points, by 5+); it
// replaces HOT PICKUP for that player.
export const MISCUE_MIN_POINTS = 12;
export const SWAP_MIN_POINTS = 5;
export const SWAP_MIN_GAP = 3;
export const SHREWD_MIN_POINTS = 8;
export const SHREWD_MIN_GAP = 5;
export const dropsData = await readJson(`${DATA}/drops.json`).catch(() => null);
export const swapPlayed = proTeamId => { const g = nflGameByProTeam.get(Number(proTeamId)); return Boolean(g && g.state !== "pre"); };
export function shrewdSwaps() {
  if (Number(dropsData?.week) !== currentWeek) return [];
  return (dropsData.drops || [])
    .filter(d => teamNames.has(d.fromTeamId) && d.added && d.added.nowOnTeamId === d.fromTeamId && swapPlayed(d.proTeamId) && swapPlayed(d.added.proTeamId)
      && d.added.points >= SHREWD_MIN_POINTS && d.added.points - d.points >= SHREWD_MIN_GAP)
    .sort((a, b) => (b.added.points - b.points) - (a.added.points - a.points));
}
// Whether the swap decides the team's matchup: the points it gained (or
// cost) are bigger than the current margin, on the side that matters.
function swapDecides(teamId, gain) {
  const team = currentScores.find(s => s.teamId === Number(teamId));
  const opp = team && currentScores.find(s => s.teamId === Number(team.opponentId));
  if (!team || !opp) return false;
  const margin = Number(team.score) - Number(opp.score);
  return gain > 0 ? margin > 0 && gain > margin : margin < 0 && -gain > -margin;
}
export function addShrewdSwapStory(add) {
  const d = shrewdSwaps()[0];
  if (!d) return;
  const last = surname;
  add("SHREWD SWAP",fit(
    "🧠 SHREWD SWAP: " + name(d.fromTeamId) + " cut " + d.player + " for " + d.added.player + ", and it's paying off — " + last(d.added.player) + " " + pts(d.added.points) + ", " + last(d.player) + " " + pts(d.points) + ".",
    "🧠 SHREWD SWAP: " + name(d.fromTeamId) + " swapped " + d.player + " for " + d.added.player + " — " + pts(d.added.points) + " vs " + pts(d.points) + "."
  ),72 + Math.min(d.added.points - d.points, 30) / 2, {decisive: swapDecides(d.fromTeamId, d.added.points - d.points)});
}
// ---- Drop regret -------------------------------------------------------------
// From drop-history.json: the player who has scored the most since a team
// let him go (25+ points), and where he is now. Only cuts from the last few
// weeks, so one old drop doesn't headline all season (Jim, 2026-10-25: the
// Maye story turned into a pile-on).
export const dropHistory = await readJson(`${DATA}/drop-history.json`).catch(() => null);
export const DROP_REGRET_MIN = 25;
export const RECENT_DROP_WEEKS = 3;
export const recentDrop = d => Number(d.dropWeek) > currentWeek - RECENT_DROP_WEEKS;
export function addDropRegretStory(add) {
  const d = (dropHistory?.drops || []).find(x => teamNames.has(x.fromTeamId) && x.nowOnTeamId !== x.fromTeamId && x.pointsSince >= DROP_REGRET_MIN && recentDrop(x));
  if (!d) return;
  const where = d.nowOnTeamId && teamNames.has(d.nowOnTeamId) ? " Now he's helping " + name(d.nowOnTeamId) + "." : !d.nowOnTeamId ? " And he's still on waivers." : "";
  const per = d.games > 1 ? " (" + (d.pointsSince / d.games).toFixed(1) + " a week)" : "";
  const avgBefore = d.gamesBefore ? d.pointsBefore / d.gamesBefore : null, avgAfter = d.games ? d.pointsSince / d.games : 0;
  // The turnaround version when he was quiet before the cut and hot since.
  const turned = avgBefore != null && avgAfter >= 2 * avgBefore && avgAfter - avgBefore >= 6;
  add("DROP REGRET",fit(
    ...(turned ? ["🗑️ DROP REGRET: " + d.player + " averaged " + avgBefore.toFixed(1) + " before " + name(d.fromTeamId) + " cut him in Week " + d.dropWeek + ". Since: " + avgAfter.toFixed(1) + " a week." + where] : []),
    "🗑️ DROP REGRET: Since " + name(d.fromTeamId) + " cut " + d.player + " in Week " + d.dropWeek + ", he's put up " + pts(d.pointsSince) + per + "." + where,
    "🗑️ DROP REGRET: " + name(d.fromTeamId) + " cut " + d.player + " in Week " + d.dropWeek + ". Since then: " + pts(d.pointsSince) + "." + where,
    "🗑️ DROP REGRET: " + name(d.fromTeamId) + " cut " + surname(d.player) + "; he's scored " + pts(d.pointsSince) + " since."
  ),64 + Math.min(16, (d.pointsSince - DROP_REGRET_MIN) / 3));
}
export function addMiscueStory(add) {
  if (Number(dropsData?.week) !== currentWeek) return;
  const played = swapPlayed;
  const day = d => new Date(d.droppedAt).toLocaleDateString("en-US", {weekday:"long", timeZone:"America/New_York"});
  const candidates = [];
  for (const d of (dropsData.drops || []).filter(d => teamNames.has(d.fromTeamId))) {
    const team = name(d.fromTeamId);
    const a = d.added;
    if (a && d.points >= SWAP_MIN_POINTS && played(d.proTeamId) && played(a.proTeamId) && d.points - a.points >= SWAP_MIN_GAP) {
      const gap = d.points - a.points;
      candidates.push({score:76 + Math.min(gap, 30) / 2, decisive:swapDecides(d.fromTeamId, -gap), text:fit(
        "🤦 MANAGER MISCUE: " + team + " dropped " + d.player + " for " + a.player + " on " + day(d) + ". So far: " + surname(d.player) + " " + pts(d.points) + ", " + surname(a.player) + " " + pts(a.points) + ".",
        "🤦 MANAGER MISCUE: " + team + " swapped " + d.player + " for " + a.player + " — " + pts(d.points) + " vs " + pts(a.points) + " so far."
      )});
    } else if (d.points >= MISCUE_MIN_POINTS) {
      const where = d.nowOnTeamId === d.fromTeamId ? "" : d.nowOnTeamId ? ", now for " + name(d.nowOnTeamId) : ", and he's still sitting on waivers";
      candidates.push({score:74 + Math.min(d.points, 40) / 4, decisive:swapDecides(d.fromTeamId, -(d.points - (a?.points ?? 0))), text:fit(
        "🤦 MANAGER MISCUE: " + team + " dropped " + d.player + (d.position ? " (" + d.position + ")" : "") + " on " + day(d) + " — he has " + pts(d.points) + " this week" + where + ".",
        "🤦 MANAGER MISCUE: " + team + " dropped " + d.player + " on " + day(d) + " — he has " + pts(d.points) + " this week" + where + ".",
        "🤦 MANAGER MISCUE: " + team + " dropped " + d.player + " — he has " + pts(d.points) + " this week."
      )});
    }
  }
  const best = candidates.sort((x, y) => y.score - x.score)[0];
  if (best) add("MANAGER MISCUE", best.text, best.score, {decisive: best.decisive});
}
