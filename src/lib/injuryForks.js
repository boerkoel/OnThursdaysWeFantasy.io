import { normalCdf, normalQuantile, restOf } from "../../scripts/lib/simulation.js";

// Two futures (Jim, 2026-11-02): when a starter goes down in a game in progress and hasn't come back, a race
// splits into the odds if he returns (today's, which still count his projection) and the odds if he doesn't (his
// remaining projection gone). The needle flails between them instead of settling on an average.
const MIN_REST = 2;       // remaining points worth forking over
const MIN_GAP = 3;        // odds points between the two futures worth showing

const last = n => String(n || "").replace(/^[A-Z]\.\s*/, "");

// A main-league team's starters hurt in a game being played now and not back yet, with their remaining points.
export function hurtStarters(team, livePlays, games) {
  const injuries = (livePlays?.injuries || []).filter(i => i.league === "main" && Number(i.teamId) === Number(team.teamId) && !i.returnedAt);
  return injuries.flatMap(i => {
    const p = (team.lineup?.starters || []).find(x => Number(x.id) === Number(i.playerId));
    const game = p && games.find(g => g.state === "in" && (g.teamIds || []).map(Number).includes(Number(p.proTeamId)));
    const rest = p ? restOf({ projection: p.projection, actual: p.actual, game }) : 0;
    return game && rest >= MIN_REST ? [{ name: last(p.name), rest }] : [];
  });
}

// The fork for odds p of the right side: right's hurt starters pull it down, left's push it up, by their
// remaining points over the race's spread sd. { pOut, label, title } or null.
export function forkFor({ p, right = [], left = [], sd, livePlays, games }) {
  const hurtR = right.flatMap(t => hurtStarters(t, livePlays, games)), hurtL = left.flatMap(t => hurtStarters(t, livePlays, games));
  if (!hurtR.length && !hurtL.length || !(p > 0 && p < 100)) return null;
  const shift = (hurtL.reduce((a, x) => a + x.rest, 0) - hurtR.reduce((a, x) => a + x.rest, 0)) / Math.max(3, sd);
  const pOut = 100 * normalCdf(normalQuantile(Math.min(0.999, Math.max(0.001, p / 100))) + shift);
  if (Math.abs(pOut - p) < MIN_GAP) return null;
  const names = [...hurtR, ...hurtL].map(x => x.name).join(" & ");
  return { pOut, label: `🚑 ${names} hurt`, names };
}
