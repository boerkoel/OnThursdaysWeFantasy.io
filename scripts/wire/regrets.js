import { DATA, fit, listNames, pickLine, readJson } from "./context.js";

// League Wire: LONG-TERM REGRET. A player still on someone's bench whom the
// manager has rarely or never started, but who would have flipped games or
// the median if he'd started over the weakest starter he could replace
// (calculate-stats.js: longTermRegrets, from each week's actual lineup).
const teamsData = await readJson(`${DATA}/teams.json`).catch(() => null);

export function addLongTermRegretStory(add) {
  const all = (teamsData?.teams || []).flatMap(t => (t.profileAnalytics?.longTermRegrets || []).map(r => ({ ...r, team: t.name })))
    .filter(r => r.winsAdded >= 1 && r.startedWeeks <= 1)
    .sort((a, b) => b.winsAdded - a.winsAdded || b.points - a.points);
  const r = all[0];
  if (!r) return;
  const weeks = r.weeks.length === 1 ? `Week ${r.weeks[0]}` : `Weeks ${listNames(r.weeks.map(String))}`;
  const benched = r.startedWeeks === 0 ? `has yet to start ${r.player}` : `has started ${r.player} just once`;
  const wins = `${r.winsAdded} more win${r.winsAdded === 1 ? "" : "s"}`;
  const lead = pickLine("regret:" + r.playerId, ["🪑 LONG-TERM REGRET", "🪑 The one that got away (on the bench)", "🪑 Bench of broken dreams"]);
  add("LONG-TERM REGRET", fit(
    `${lead}: ${r.team} ${benched}. Starting him in ${weeks} would have meant ${wins} by now (+${r.points.toFixed(2)} pts).`,
    `${lead}: ${r.team} ${benched}. Starting him in ${weeks} would have meant ${wins} by now.`,
    `${lead}: ${r.team} ${benched}, and it's cost ${r.winsAdded === 1 ? "a win" : r.winsAdded + " wins"}.`
  ), 54 + 6 * r.winsAdded);
}
