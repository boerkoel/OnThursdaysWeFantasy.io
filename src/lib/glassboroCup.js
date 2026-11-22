import { recordBook, rivalryBetween } from "./recordBook.js";

// The Glassboro Cup (Jim, 2026-11-15): Joe and Billy's own trophy, "just the tip". Whoever wins a Joe v. Billy game,
// from 2026 Week 10 on, holds it until the next one. Keyed by manager (record-book.json ids), so it follows them
// to new team ids in later seasons: Joe = Mr. Action Jackson (team 8 in 2026), Billy = Gibb it to Me Baby (team 10).
// Two families since Jim, 2026-11-22: any Mette team against any Halverson team is a Cup game, and the Cup goes to
// whichever team won the latest one. Mette = Claremont In Yo Stace! (team 6) and Mr. Action Jackson (8); Halverson =
// Ruffing the Passer (7) and Gibb it to Me Baby (10).
export const CUP_SIDES = [["3aa5ae8f2954", "05bdb85a2e29"], ["3f22f3121f5f", "abd12f858574"]];
export const CUP_MANAGERS = CUP_SIDES.flat();
const SINCE = { season: 2026, week: 10 };
const CUP_SRC = `${import.meta.env.BASE_URL}glassboro-cup.svg`;
export const cupImage = CUP_SRC;

const managerOf = teamId => recordBook?.currentTeamManagers?.[teamId];
const teamOf = manager => Object.entries(recordBook?.currentTeamManagers || {}).find(([, m]) => m === manager)?.[0];

// Whether these two teams' game is a Cup game: one from each family.
export function isCupGame(teamIdA, teamIdB) {
  const [a, b] = [managerOf(teamIdA), managerOf(teamIdB)];
  return CUP_SIDES.some(([x, y], i) => [x, y].includes(a) && CUP_SIDES[1 - i].includes(b));
}

// The team id holding the Cup (winner of the latest Cup game across the four pairings, from the record book's
// completed weeks), or null.
export function cupHolder() {
  const when = m => m.season * 100 + m.week;
  const last = CUP_SIDES[0].flatMap(x => CUP_SIDES[1].map(y => rivalryBetween(x, y)?.lastMeeting))
    .filter(m => m?.winner && when(m) >= SINCE.season * 100 + SINCE.week).sort((m, n) => when(n) - when(m))[0];
  return last ? Number(teamOf(last.winner)) || null : null;
}
