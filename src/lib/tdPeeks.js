import { normalCdf, normalQuantile, restOf } from "../../scripts/lib/simulation.js";

// TD peeks (Jim, 2026-11-02): a touchdown is one lump, not a smooth drift, so a race shouldn't hide that the one
// player left might score. For each starter in a game being played: his chance of a TD in the time left (from
// his remaining projection, more of which is TDs for a QB) and the odds if he gets one, which the needle visits
// now and then in proportion. TD worth in this league: a catch about 9 (6 + 1 per catch + ~20 yds), a run 6.5,
// a QB's passing TD 4.8 (4 + ~20 yds).
const TD_POINTS = { QB: 4.8, RB: 6.5, WR: 9, TE: 9 };
const TD_RATE = { QB: 0.12, RB: 0.07, WR: 0.06, TE: 0.07 };   // per remaining point: chance = 1 - e^(-rate × rest)
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
      if (!TD_POINTS[pl.pos]) continue;
      const game = games.find(g => g.state === "in" && (g.teamIds || []).map(Number).includes(Number(pl.proTeamId)));
      if (!game) continue;
      const rest = restOf({ projection: pl.projection, actual: pl.actual, game });
      const chance = 1 - Math.exp(-TD_RATE[pl.pos] * rest);
      const after = 100 * normalCdf(z + sign * TD_POINTS[pl.pos] / Math.max(3, sd));
      if (chance >= 0.02 && Math.abs(after - p) >= MIN_MOVE) peeks.push({ p: after, chance, label: `🏈 if ${last(pl.name)} scores` });
    }
  }
  return peeks;
}
