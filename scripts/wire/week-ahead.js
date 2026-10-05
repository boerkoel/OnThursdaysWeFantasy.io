import { currentScores, currentWeek, currentWeekMatchups, money, name, pct, recordBook, seasonOddsData, standingsData } from "./context.js";

// League Wire: the week ahead (rivalries, streaks, title odds).
// ---- Week ahead -----------------------------------------------------------
// Before anyone in the league has scored this week: rivalry history, streaks,
// big matchups at the top (or bottom) of the standings, and title odds.

export function addWeekAheadStories(add) {
  if (currentScores.some(s => Number(s.score) !== 0)) return;
  const record = t => t ? t.h2hWins + "–" + t.h2hLosses : "";
  const standings = (standingsData?.standings || []);
  const rankOf = new Map(standings.map((t, i) => [Number(t.id), {...t, rank:i + 1}]));

  // Rivalries: the most-played series among this week's matchups.
  const managerOf = recordBook?.currentTeamManagers || {};
  const series = currentWeekMatchups.map(m => {
    const ma = managerOf[m.homeTeamId], mb = managerOf[m.awayTeamId];
    const r = (recordBook?.rivalries || []).find(x => (x.a === ma && x.b === mb) || (x.a === mb && x.b === ma));
    if (!r || r.games < 3) return null;
    const teamFor = manager => manager === ma ? m.homeTeamId : m.awayTeamId;
    return {r, teamFor};
  }).filter(Boolean).sort((x, y) => y.r.games - x.r.games);
  for (const {r, teamFor} of series.slice(0, 2)) {
    const [lead, trail, lw, tw] = r.aWins >= r.bWins ? [r.a, r.b, r.aWins, r.bWins] : [r.b, r.a, r.bWins, r.aWins];
    const recordText = lw === tw ? name(teamFor(lead)) + " and " + name(teamFor(trail)) + " are all square at " + lw + "–" + tw + (r.ties ? "–" + r.ties : "") + " all-time"
      : name(teamFor(lead)) + " leads " + name(teamFor(trail)) + " " + lw + "–" + tw + (r.ties ? "–" + r.ties : "") + " all-time";
    const streak = r.streak?.length >= 2 ? ", and " + name(teamFor(r.streak.manager)) + " has won the last " + r.streak.length : "";
    add("RIVALRY WEEK","🤝 Rivalry week: " + recordText + streak + ".",64 + Math.min(r.games, 10) / 2);
  }

  // Streaks worth mentioning, with who's next.
  const opponentOf = id => { const m = currentWeekMatchups.find(x => x.homeTeamId === id || x.awayTeamId === id); return m ? name(m.homeTeamId === id ? m.awayTeamId : m.homeTeamId) : null; };
  const hot = standings.filter(t => t.streak?.type === "W" && t.streak.length >= 3).sort((a, b) => b.streak.length - a.streak.length)[0];
  if (hot && opponentOf(hot.id)) add("ON A ROLL","🔥 " + hot.name + " has won " + hot.streak.length + " straight. " + opponentOf(hot.id) + " gets the next crack at them.",58 + hot.streak.length);
  const cold = standings.filter(t => t.streak?.type === "L" && t.streak.length >= 3).sort((a, b) => b.streak.length - a.streak.length)[0];
  if (cold && opponentOf(cold.id)) add("SKID WATCH","🥶 " + cold.name + " has dropped " + cold.streak.length + " straight. Can they snap it against " + opponentOf(cold.id) + "?",56 + cold.streak.length);

  // Top-of-the-table clash, or a battle of the winless.
  const clash = currentWeekMatchups.map(m => ({m, a:rankOf.get(m.homeTeamId), b:rankOf.get(m.awayTeamId)}))
    .filter(x => x.a && x.b).sort((x, y) => (x.a.rank + x.b.rank) - (y.a.rank + y.b.rank))[0];
  if (clash && clash.a.rank <= 4 && clash.b.rank <= 4) {
    const [hi, lo] = clash.a.rank < clash.b.rank ? [clash.a, clash.b] : [clash.b, clash.a];
    add("HEAVYWEIGHT BOUT","🥊 Heavyweight bout: #" + hi.rank + " " + hi.name + " (" + record(hi) + ") meets #" + lo.rank + " " + lo.name + " (" + record(lo) + ").",68);
  }
  const winless = currentWeekMatchups.map(m => [rankOf.get(m.homeTeamId), rankOf.get(m.awayTeamId)])
    .find(([a, b]) => a && b && a.games > 0 && a.h2hWins === 0 && b.h2hWins === 0);
  if (winless) add("TOILET BOWL PREVIEW","🚽 Something's gotta give: winless " + winless[0].name + " and " + winless[1].name + " meet, and one of them gets off the schneid.",62);

  // Title favorite from the season simulation.
  const odds = (seasonOddsData?.teams || []).slice().sort((a, b) => b.titleOdds - a.titleOdds);
  if (odds.length >= 2 && Number(seasonOddsData.week) === currentWeek) {
    add("TITLE ODDS","🏆 Title odds entering Week " + currentWeek + ": " + odds[0].team + " " + pct(odds[0].titleOdds) + ", " + odds[1].team + " " + pct(odds[1].titleOdds) + (odds[2] ? ", " + odds[2].team + " " + pct(odds[2].titleOdds) : "") + ".",57);
  }
}
