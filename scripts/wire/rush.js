import { fit, name, nflGames, pct, pickLine, seasonOddsData } from "./context.js";

// League Wire: the 100-Yard Rush's biggest mover (Jim, 2026-11-24). Playoff odds as yards: the team that gained or
// lost the most ground this week (from the field's trail in season-odds.json), or last week's between weeks, with
// the ground it gave back (or made up) when its range ran well past the net move.
export const RUSH_MIN_YARDS = 8;
export function addRushStory(add) {
  const d = seasonOddsData;
  if (!d?.teams?.length) return;
  const live = nflGames.some(g => g.state && g.state !== "pre") && d.weekTrail?.points?.length > 1;
  const trail = live ? d.weekTrail : d.lastWeekTrail;
  if (!trail?.points?.length || trail.points.length < 2) return;
  const now = new Map(d.teams.map(t => [Number(t.teamId), Number(t.playoffOdds)]));
  const points = trail.points.map(([, ...odds]) => odds);
  const movers = trail.ids.map((id, i) => {
    const path = points.map(p => p[i]).concat(live ? [now.get(Number(id))] : []).filter(Number.isFinite);
    const from = path[0], to = path[path.length - 1];
    return { id: Number(id), from, to, net: Math.round(to - from), hi: Math.max(...path), lo: Math.min(...path) };
  }).filter(m => Number.isFinite(m.net)).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const m = movers[0];
  if (!m || Math.abs(m.net) < RUSH_MIN_YARDS) return;

  const up = m.net > 0, yards = Math.abs(m.net), when = live ? "this week" : "last week";
  const odds = `${pct(m.from)} → ${pct(m.to)}`;
  // The ground it covered beyond the net move: a peak it fell back from, or a hole it climbed out of.
  const extra = up ? Math.round(m.from - m.lo) : Math.round(m.hi - m.from);
  const detour = extra >= 10 ? (up ? ` after being stuffed back to ${pct(m.lo)}` : ` after breaking out to ${pct(m.hi)}`) : "";
  const verb = live ? (up ? `is on a ${yards}-yard run` : `has lost ${yards} yards`) : (up ? `ripped off a ${yards}-yard run` : `lost ${yards} yards`);
  const flair = pickLine("rush" + m.id + when, up ? [
    "Somebody call the replay booth.",
    "Broke three tackles and the will of the group chat.",
    "The defense is still looking for its contact lens.",
    "Hit the hole and never looked back."
  ] : [
    "Sacked, stripped, and the fumble rolled out of bounds.",
    "Pinned deep. Somebody warm up the punter.",
    "That's a drive-killer.",
    "Lost the handoff and most of the dignity."
  ]);
  const team = name(m.id);
  add("100-YARD RUSH", fit(
    `🏈 100-YARD RUSH: ${team} ${verb} ${when}${detour}, ${odds} playoff odds. ${flair}`,
    `🏈 100-YARD RUSH: ${team} ${verb} ${when}${detour}, ${odds} playoff odds.`,
    `🏈 100-YARD RUSH: ${team} ${verb} ${when}, ${odds}.`
  ), (live ? 62 : 74) + Math.min(yards, 30) / 3);   // between weeks it's the race's recap: one of the eight that always show
}
