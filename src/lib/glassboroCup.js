import { recordBook, rivalryBetween } from "./recordBook.js";

// The Glassboro Cup (Jim, 2026-11-15): Joe and Billy's own trophy, "just the tip". Whoever wins a Joe v. Billy game,
// from 2026 Week 10 on, holds it until the next one. Keyed by manager (record-book.json ids), so it follows them
// to new team ids in later seasons: Joe = Mr. Action Jackson (team 8 in 2026), Billy = Gibb it to Me Baby (team 10).
export const CUP_MANAGERS = ["05bdb85a2e29", "abd12f858574"];
const SINCE = { season: 2026, week: 10 };
const CUP_SRC = `${import.meta.env.BASE_URL}glassboro-cup.svg`;
export const cupImage = CUP_SRC;

const managerOf = teamId => recordBook?.currentTeamManagers?.[teamId];
const teamOf = manager => Object.entries(recordBook?.currentTeamManagers || {}).find(([, m]) => m === manager)?.[0];

// Whether these two teams' game is a Cup game.
export function isCupGame(teamIdA, teamIdB) {
  const pair = [managerOf(teamIdA), managerOf(teamIdB)];
  return CUP_MANAGERS.every(m => pair.includes(m));
}

// The team id holding the Cup (winner of the latest Cup game, from the record book's completed weeks), or null.
export function cupHolder() {
  const last = rivalryBetween(CUP_MANAGERS[0], CUP_MANAGERS[1])?.lastMeeting;
  if (!last?.winner) return null;
  const after = last.season > SINCE.season || (last.season === SINCE.season && last.week >= SINCE.week);
  return after ? Number(teamOf(last.winner)) || null : null;
}
