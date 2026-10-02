// Shared Monte Carlo pieces for the main league scoreboard and the guillotine
// Death Watch. Each starter still to play adds a random amount around the
// points ESPN still projects for them:
// - it can be negative (an interception-filled night, a defense that gets
//   torched, a kicker who misses), down to a floor that depends on position;
// - there's a chance the player leaves early or doesn't play (injury, late
//   scratch) and adds only a fraction of what was projected.
// The spreads and rates below are reasonable estimates, not fitted to data.

export const SIMULATIONS = 10000;

// ESPN position ids: 1 QB, 2 RB, 3 WR, 4 TE, 5 K, 16 D/ST.
// Spread of a player's remaining points as a fraction of what's projected
// (defenses and kickers swing the most), with a minimum so a player already
// past their projection still varies.
const SD_FRACTION = { 1: 0.5, 2: 0.65, 3: 0.7, 4: 0.75, 5: 0.7, 16: 1.0 };
const DEFAULT_SD_FRACTION = 0.7;
const MIN_SPREAD_POINTS = 3;

// The most a player could plausibly lose from here.
const NEGATIVE_FLOOR = { 1: 6, 2: 1, 3: 1, 4: 1, 5: 4, 16: 10 };
const DEFAULT_FLOOR = 2;

// Chance a player who hasn't started leaves early or doesn't play, scaled down
// by how much of their projection is already in. If it happens, they add only
// 0-30% of what they still had projected.
const EARLY_EXIT_RATE = 0.06;
const EARLY_EXIT_SHARE = 0.3;

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
  const shareLeft = Number.isFinite(projection) && projection > 0 ? Math.min(1, rest / projection) : 0.5;
  return {
    rest,
    sd: (SD_FRACTION[Number(positionId)] ?? DEFAULT_SD_FRACTION) * Math.max(rest, MIN_SPREAD_POINTS),
    floor: NEGATIVE_FLOOR[Number(positionId)] ?? DEFAULT_FLOOR,
    exitRisk: EARLY_EXIT_RATE * shareLeft
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
// If given, playerPoints[i] is set to player i's simulated points.
export function simulateFinal(team, rng, playerPoints = null) {
  let total = team.score;
  team.players.forEach((p, i) => {
    const points = rng() < p.exitRisk
      ? p.rest * EARLY_EXIT_SHARE * rng()
      : Math.max(-p.floor, p.rest + p.sd * normal(rng));
    if (playerPoints) playerPoints[i] = points;
    total += points;
  });
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
