import { TD_POINTS as TD_BY_POSITION, gameShareLeft, normalCdf, normalQuantile, restOf, tdChance } from "../../scripts/lib/simulation.js";

// TD peeks (Jim, 2026-11-02): a touchdown is one lump, not a smooth drift, so a race shouldn't hide that the one
// player left might score. For each starter in a game being played: his chance of a TD in the time left (from
// his remaining projection, more of which is TDs for a QB) and the odds if he gets one, which the needle visits
// now and then in proportion. TD worth in this league: a catch about 9 (6 + 1 per catch + ~20 yds), a run 6.5,
// a QB's passing TD 4.8 (4 + ~20 yds).
// The chances and worths are the simulation's (simulation.js tdChance), so the peeks match the odds.
const POSITION_IDS = { QB: 1, RB: 2, WR: 3, TE: 4 };
// The other plays that swing a race (Jim, 2026-11-02), each with its worth in this league and how often a starter
// makes it in a full game (rough NFL rates), scaled to the time left. The QB's TD pass and the skill players' TDs
// come from the simulation's TD chances above.
const BIG_PLAYS = {
  QB: [{ pts: -2, perGame: 0.75, text: n => `😬 if ${n} throws a pick` }, { pts: -2, perGame: 0.15, text: n => `😬 if ${n} fumbles` }],
  RB: [{ pts: 4, perGame: 0.25, text: n => `💨 if ${n} breaks a long run` }, { pts: -2, perGame: 0.1, text: n => `😬 if ${n} fumbles` }],
  WR: [{ pts: 5, perGame: 0.3, text: n => `🙌 if ${n} hauls in a 40-yarder` }],
  TE: [{ pts: 5, perGame: 0.15, text: n => `🙌 if ${n} hauls in a 40-yarder` }],
  K: [{ pts: 3.5, perGame: 1.6, text: n => `🎯 if ${n} kicks a FG` }, { pts: 5, perGame: 0.35, text: n => `🎯 if ${n} hits a 50-yarder` },
    { pts: -1, perGame: 0.25, text: n => `❌ if ${n} misses` }],
  "D/ST": [{ pts: 8, perGame: 0.12, text: n => `🛡️ if the ${n} scores` }, { pts: 2, perGame: 0.8, text: n => `🛡️ if the ${n} picks one off` },
    { pts: 2, perGame: 0.55, text: n => `🛡️ if the ${n} recovers a fumble` }]
};
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
      const game = games.find(g => g.state === "in" && (g.teamIds || []).map(Number).includes(Number(pl.proTeamId)));
      if (!game) continue;
      const pos = POSITION_IDS[pl.pos], name = /D\/ST/.test(pl.name) ? pl.name : last(pl.name);
      const plays = [];
      if (pos) {
        const rest = restOf({ projection: pl.projection, actual: pl.actual, game });
        plays.push({ pts: TD_BY_POSITION[pos], chance: tdChance(pos, rest), text: pl.pos === "QB" ? `🏈 if ${name} throws a TD` : `🏈 if ${name} scores` });
      }
      const share = gameShareLeft(game) ?? 1;
      for (const b of BIG_PLAYS[pl.pos] || []) plays.push({ pts: b.pts, chance: 1 - Math.exp(-b.perGame * share), text: b.text(name) });
      for (const play of plays) {
        const after = 100 * normalCdf(z + sign * play.pts / Math.max(3, sd));
        if (play.chance >= 0.02 && Math.abs(after - p) >= MIN_MOVE) peeks.push({ p: after, chance: play.chance, label: play.text, pts: sign * play.pts });
      }
    }
  }
  return peeks;
}

// Median echoes (Jim, 2026-11-09: "have the other needles bounce with it"): another team's big moment (events:
// its own median peeks, with pts and from) lifts the median line a little: its points times half the chance that
// team is one of the two middle scores (about 2 · 4q(1−q) / teams, for its chance q of beating the median). Every
// other team's median needle visits that, silently: the story's label stays on its own team's needle.
export function medianEchoes(t, events, teams, sd) {
  const p = Number(t.aboveMedianProbability);
  if (!(p > 0 && p < 100) || !(sd > 0) || !teams) return [];
  const z = normalQuantile(Math.min(0.999, Math.max(0.001, p / 100)));
  const out = [];
  for (const e of events) {
    if (e.from.teamId === t.teamId || !Number.isFinite(e.pts)) continue;
    const q = Math.min(1, Math.max(0, Number(e.from.aboveMedianProbability) / 100));
    const after = 100 * normalCdf(z - e.pts * (4 * q * (1 - q)) / teams / Math.max(3, sd));
    if (Math.abs(after - p) >= 0.5) out.push({ key: e.key ?? e.label, label: e.label, p: after, chance: e.chance, pregame: e.pregame, silent: true });
  }
  return out;
}

// The chop's peeks: a guillotine team's own plays move its chop odds (its points push them down), against the
// widest spread among the other teams still at risk.
export function chopPeeks(team, teams, games) {
  const rivals = teams.filter(t => t !== team && t.chopProbability > 0.5 && t.chopProbability < 99.5).map(t => Number(t.projectionSd) || 0);
  const sd = Math.hypot(Number(team.projectionSd) || 0, rivals.length ? Math.max(...rivals) : 0);
  return tdPeeks({ p: Number(team.chopProbability), left: [{ lineup: { starters: team.lineup || [] } }], sd, games });
}
