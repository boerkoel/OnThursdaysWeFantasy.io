import { currentScores, currentWeek, DATA, name, pct, pickLine, readJson } from "./context.js";

// League Wire: GLASSBORO CUP (Jim, 2026-11-22: "it becomes a story line when it goes back up for grabs"). The Cup is a
// title belt (src/lib/glassboroCup.js, same rule here): the first Mette v. Halverson game from 2026 Week 10 crowned a
// holder, and it changes hands only when the holder loses to the other family. A story when the holder's title is on
// the line this week, and one when it just changed hands.
const SIDES = [["3aa5ae8f2954", "05bdb85a2e29"], ["3f22f3121f5f", "abd12f858574"]];
const SINCE = { season: 2026, week: 10 };
const book = await readJson(`${DATA}/record-book.json`).catch(() => null);
const weekly = await readJson(`${DATA}/weekly.json`).catch(() => null);
const familyOf = id => SIDES.findIndex(s => s.includes(book?.currentTeamManagers?.[id]));
const cross = (a, b) => familyOf(a) >= 0 && familyOf(b) >= 0 && familyOf(a) !== familyOf(b);

// [holder before the latest Cup game, holder now, week of that game]
function belt() {
  let holder = null, before = null, week = null;
  for (const w of (weekly?.weeks || []).filter(w => Number(weekly.season) > SINCE.season || w.week >= SINCE.week)) {
    for (const m of w.matchups || []) {
      const [h, a] = [Number(m.homeTeamId), Number(m.awayTeamId)];
      if (!m.completed || !cross(h, a) || (holder != null && holder !== h && holder !== a)) continue;
      before = holder; week = w.week;
      holder = m.winner === "HOME" ? h : m.winner === "AWAY" ? a : holder;
    }
  }
  return [before, holder, week];
}

export function addGlassboroStory(add) {
  if (!book || !weekly) return;
  const [before, holder, week] = belt();
  // Just changed hands (last week's game).
  if (holder != null && before != null && before !== holder && week === currentWeek - 1)
    add("GLASSBORO CUP", `🏆 NEW CHAMP: ${name(holder)} took the Glassboro Cup from ${name(before)}. It's theirs until they lose it.`, 84);
  // On the line this week.
  const s = currentScores.find(x => cross(Number(x.teamId), Number(x.opponentId)) && (holder == null || Number(x.teamId) === holder));
  if (!s) return;
  const p = Number(s.winProbability);
  const odds = p > 0 && p < 100 ? ` ${pct(p)} to keep it.` : "";
  const lead = holder == null ? `🏆 GLASSBORO CUP: ${name(s.teamId)} vs ${name(s.opponentId)} crowns the first holder.`
    : pickLine("cup" + currentWeek, [`🏆 GLASSBORO CUP: ${name(s.teamId)} puts the belt on the line against ${name(s.opponentId)}.`,
      `🏆 TITLE DEFENSE: ${name(s.teamId)} defends the Glassboro Cup against ${name(s.opponentId)}.`]);
  add("GLASSBORO CUP", lead + (holder == null ? "" : odds), 83);
}
