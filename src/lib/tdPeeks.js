import { TD_POINTS as TD_BY_POSITION, normalCdf, normalQuantile, restOf, tdChance } from "../../scripts/lib/simulation.js";

// TD peeks (Jim, 2026-11-02): a touchdown is one lump, not a smooth drift, so a race shouldn't hide that the one
// player left might score. For each starter in a game being played: his chance of a TD in the time left (from
// his remaining projection, more of which is TDs for a QB) and the odds if he gets one, which the needle visits
// now and then in proportion. TD worth in this league: a catch about 9 (6 + 1 per catch + ~20 yds), a run 6.5,
// a QB's passing TD 4.8 (4 + ~20 yds).
// The chances and worths are the simulation's (simulation.js tdChance), so the peeks match the odds.
const POSITION_IDS = { QB: 1, RB: 2, WR: 3, TE: 4 };
const MIN_MOVE = 4;                                          // odds points a TD must move to be worth a peek
const last = n => String(n || "").replace(/^[A-Z]\.\s*/, "");

// p: odds of the right side; right/left: teams whose players push it up/down; sd: the race's spread.
// [{ p (odds if he scores), chance, label }]
export function tdPeeks({ p, right = [], left = [], sd, games }) {
  if (!(p > 0 && p < 100)) return [];
  const z = normalQuantile(Math.min(0.999, Math.max(0.001, p / 100)));
  const peeks = [];
  for (const [teams, sign] of [[right, 1], [left, -1]]) {
    for (const t of teams) for (const pl of t.lineup?.starters || []) {
      const pos = POSITION_IDS[pl.pos];
      if (!pos) continue;
      const game = games.find(g => g.state === "in" && (g.teamIds || []).map(Number).includes(Number(pl.proTeamId)));
      if (!game) continue;
      const rest = restOf({ projection: pl.projection, actual: pl.actual, game });
      const chance = tdChance(pos, rest);
      const after = 100 * normalCdf(z + sign * TD_BY_POSITION[pos] / Math.max(3, sd));
      if (chance >= 0.02 && Math.abs(after - p) >= MIN_MOVE) peeks.push({ p: after, chance, label: `🏈 if ${last(pl.name)} scores` });
    }
  }
  return peeks;
}
