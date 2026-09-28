// Shared Monte Carlo pieces for the main league scoreboard and the guillotine
// Death Watch. Each starter still to play adds a random amount around the
// points ESPN still projects for them; that amount can be negative (an
// interception-filled night, a defense that gets torched), down to a floor
// that depends on position.

export const SIMULATIONS = 10000;

// Spread of a player's remaining points, as a fraction of what's projected,
// with a minimum so a player already past their projection still varies.
const SD_FRACTION = 0.6;
const MIN_SPREAD_POINTS = 3;

// The most a player could plausibly lose from here, by ESPN position id.
const NEGATIVE_FLOOR = { 1: 6, 2: 2, 3: 2, 4: 2, 5: 3, 16: 8 }; // QB, RB, WR, TE, K, D/ST
const DEFAULT_FLOOR = 2;

export const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function medianOf(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// What a starter who hasn't finished might still add.
export function playerOutlook({ actual, projection, positionId }) {
  const rest = Number.isFinite(projection) ? Math.max(0, projection - (Number(actual) || 0)) : 0;
  return {
    rest,
    sd: SD_FRACTION * Math.max(rest, MIN_SPREAD_POINTS),
    floor: NEGATIVE_FLOOR[Number(positionId)] ?? DEFAULT_FLOOR
  };
}

// Deterministic for the same inputs, so odds don't jitter between refreshes
// when nothing has changed.
export function seededRng(seedValues) {
  let state = 2166136261;
  for (const char of JSON.stringify(seedValues)) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function normal(rng) {
  return Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
}

// team: { score, players: [playerOutlook, ...] } for starters still to play.
export function simulateFinal(team, rng) {
  let total = team.score;
  for (const p of team.players) total += Math.max(-p.floor, p.rest + p.sd * normal(rng));
  return total;
}

// Lowest and highest possible final score. Used to report outcomes that are
// truly locked exactly (0% or 100%) instead of as simulation odds.
export function scoreRange(team) {
  if (!team.players.length) return { min: team.score, max: team.score };
  return { min: team.score - team.players.reduce((sum, p) => sum + p.floor, 0), max: Infinity };
}

// Odds for an outcome that is still possible either way: start with one
// simulated success and one failure so it never reads exactly 0% or 100%.
export const possibleOdds = count => round(((count + 1) / (SIMULATIONS + 2)) * 100);
