import { recordBook } from "./recordBook.js";
import weekly from "../../data/current/weekly.json";

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

const familyOf = teamId => CUP_SIDES.findIndex(side => side.includes(managerOf(teamId)));
const crossFamily = (a, b) => familyOf(a) >= 0 && familyOf(b) >= 0 && familyOf(a) !== familyOf(b);

// A title belt (Jim, 2026-11-22: "a belt you have to earn and keep"): the first Mette v. Halverson game from Week 10
// on crowns a holder; after that the Cup changes hands only when the holder loses to a team from the other family.
// Walks this season's completed games in order (weekly.json); returns the team id holding it, or null.
export function cupHolder() {
  let holder = null;
  for (const w of (weekly?.weeks || []).filter(w => Number(weekly.season) > SINCE.season || w.week >= SINCE.week)) {
    for (const m of w.matchups || []) {
      const [h, a] = [Number(m.homeTeamId), Number(m.awayTeamId)];
      if (!m.completed || !crossFamily(h, a) || (holder != null && holder !== h && holder !== a)) continue;
      holder = m.winner === "HOME" ? h : m.winner === "AWAY" ? a : holder;
    }
  }
  return holder;
}

// Whether these two teams' game is a Cup game: one from each family, with the holder in it (any such game while
// the Cup is unclaimed).
export function isCupGame(teamIdA, teamIdB) {
  if (!crossFamily(Number(teamIdA), Number(teamIdB))) return false;
  const holder = cupHolder();
  return holder == null || holder === Number(teamIdA) || holder === Number(teamIdB);
}
