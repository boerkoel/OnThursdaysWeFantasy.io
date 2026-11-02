import { DATA, currentScores, currentWeek, fit, money, nflGames, pickLine, readJson } from "./context.js";

// League Wire: WHIPLASH (Jim, 2026-11-02). A start/sit call that backfired last week, got flipped this week,
// and backfired again: last week B sat while A started and B outscored A; this week B starts, A sits, and A
// outscores B. Same position, 5+ points each way, both of this week's games final. Last week's lineups come
// from calculate-stats.js (teams.json recentLineups); this week's from the live scoreboard.
const teamsData = await readJson(`${DATA}/teams.json`).catch(() => null);
const MIN_GAP = 5;

const gameDone = p => nflGames.find(g => (g.teamIds || []).map(Number).includes(Number(p.proTeamId)))?.completed === true;
const lastName = n => String(n || "").replace(/^[A-Z]\.\s*/, "");

export function addWhiplashStory(add) {
  const lineupsOf = new Map((teamsData?.teams || []).map(t => [Number(t.id), t.profileAnalytics?.recentLineups || []]));
  const found = [];
  for (const s of currentScores) {
    const prev = lineupsOf.get(Number(s.teamId))?.find(l => Number(l.week) === currentWeek - 1);
    if (!prev) continue;
    const starters = new Map((s.lineup?.starters || []).map(p => [Number(p.id), p]));
    const bench = new Map((s.lineup?.bench || []).filter(p => Number(p.slot) !== 21).map(p => [Number(p.id), p]));
    for (const a of prev.players.filter(p => p.started)) {
      for (const b of prev.players.filter(p => !p.started && p.pos === a.pos)) {
        const was = b.points - a.points, aNow = bench.get(a.id), bNow = starters.get(b.id);
        if (was < MIN_GAP || !aNow || !bNow || !gameDone(aNow) || !gameDone(bNow)) continue;
        const now = Number(aNow.actual) - Number(bNow.actual);
        if (now < MIN_GAP) continue;
        // What last week's call cost: the head-to-head and median wins the swap would have flipped.
        const flip = target => Number.isFinite(Number(target)) && prev.score < target && prev.score + was > target;
        const winsLost = (flip(prev.opponentScore) ? 1 : 0) + (flip(prev.median) ? 1 : 0);
        const costingNow = Number(s.score) < Number(s.opponentScore) && Number(s.score) + now > Number(s.opponentScore);
        found.push({ s, prev, a: aNow, b: bNow, was, now, winsLost, costingNow });
      }
    }
  }
  const w = found.sort((x, y) => (y.winsLost + (y.costingNow ? 2 : 0)) - (x.winsLost + (x.costingNow ? 2 : 0)) || (y.was + y.now) - (x.was + x.now))[0];
  if (!w) return;
  const lead = pickLine("whiplash:" + w.s.teamId + ":" + w.a.id, ["🔄 WHIPLASH", "🔄 Damned if you do", "🔄 Can't win"]);
  const cost = w.winsLost === 2 ? " and two wins" : w.winsLost ? " and a win" : "";
  const again = w.costingNow ? " Wrong again, and it's the difference vs " + w.s.opponent + "." : "";
  const A = lastName(w.a.name), B = lastName(w.b.name);
  add("WHIPLASH", fit(
    `${lead}: ${w.s.team} sat ${w.b.name} for ${w.a.name} in Week ${w.prev.week}, costing ${money(w.was)} pts${cost}. Flipped them this week: ${A} outscored ${B} by ${money(w.now)}.${again}`,
    `${lead}: ${w.s.team} sat ${B} for ${A} in Week ${w.prev.week} (−${money(w.was)} pts${cost}). Flipped them this week: ${A} outscored ${B} by ${money(w.now)}.${again}`,
    `${lead}: ${w.s.team} sat ${B} for ${A} in Week ${w.prev.week} (−${money(w.was)}${cost}). Flipped them this week: ${A} won by ${money(w.now)}.`,
    `${lead}: ${w.s.team} sat ${B} for ${A} last week (−${money(w.was)}), flipped them, and ${A} won by ${money(w.now)}.`
  ), Math.min(94, 72 + 8 * w.winsLost + (w.costingNow ? 12 : 0)));
}
